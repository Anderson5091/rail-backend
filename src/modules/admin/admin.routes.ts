import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/database";
import { ENV } from "../../config/env";
import { authenticate, AuthRequest, requireRole } from "../../middleware/auth";
import { ledgerService } from "../ledger/ledger.service";

const router = Router();

router.get("/dashboard", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "COMPLIANCE", "TREASURY", "OPS"), async (_req: AuthRequest, res: Response) => {
  const [totalUsers, activeUsers, totalTransfers, pendingKyc, totalVolume, failedPayouts, openCases, fraudAlerts, partnerAgents, internalAgents, pendingCashRequests, pendingSettlements, pendingTransfers, pendingReconciliation, discrepancyReconciliation, alerts, recentActivity, tier1Count, tier2Count, tier3Count] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { wallets: { status: "ACTIVE" } } }),
    prisma.transfer.count(),
    prisma.kycProfile.count({ where: { status: { in: ["PENDING", "PENDING_REVIEW", "IN_REVIEW"] } } }),
    prisma.treasuryWallet.aggregate({ _sum: { balance: true } }),
    prisma.payoutOrder.count({ where: { status: "FAILED" } }),
    prisma.complianceCase.count({ where: { status: { in: ["OPEN", "INVESTIGATING"] } } }),
    prisma.systemAlert.count({ where: { severity: { in: ["CRITICAL", "HIGH"] }, status: "OPEN" } }),
    prisma.agent.count({ where: { type: "PARTNER" } }),
    prisma.agent.count({ where: { type: "INTERNAL" } }),
    prisma.agentCashRequest.count({ where: { status: "PENDING" } }),
    prisma.agentSettlement.count({ where: { status: "PENDING" } }),
    prisma.transfer.count({ where: { status: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] } } }),
    prisma.payoutOrder.count({ where: { status: "DELIVERED" } }),
    prisma.payoutOrder.count({ where: { status: "FAILED" } }),
    prisma.systemAlert.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.adminActionLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.user.count({ where: { kycTier: 1 } }),
    prisma.user.count({ where: { kycTier: 2 } }),
    prisma.user.count({ where: { kycTier: 3 } }),
  ]);

  res.json({
    totalUsers,
    activeUsers,
    totalTransfers,
    totalVolume: Number(totalVolume._sum.balance) || 0,
    pendingKyc,
    failedPayouts,
    openCases,
    fraudAlerts,
    totalAgents: partnerAgents + internalAgents,
    partnerAgents,
    internalAgents,
    pendingCashRequests,
    pendingSettlements,
    pendingTransfers,
    pendingReconciliation,
    discrepancyReconciliation,
    kycTiers: { tier1: tier1Count, tier2: tier2Count, tier3: tier3Count },
    alerts: alerts.map((a: { id: string; severity: string; message: string | null; createdAt: Date }) => ({
      id: a.id,
      severity: a.severity as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      message: a.message || "",
      timestamp: a.createdAt,
    })),
    recentActivity: recentActivity.map((r: { id: string; action: string; entity: string | null; adminId: string; createdAt: Date }) => ({
      id: r.id,
      action: r.action,
      user: r.entity || r.adminId || "System",
      timestamp: r.createdAt,
    })),
  });
});

router.get("/users", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS"), async (_req: AuthRequest, res: Response) => {
  const users = await prisma.user.findMany({
    select: {
      id: true, email: true, fullName: true, createdAt: true,
      kycProfile: { select: { tier: true } },
      wallets: { select: { status: true } },
      _count: { select: { transfers: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const userIds = users.map((u: { id: string }) => u.id);
  const volumeRows = await prisma.transfer.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds }, status: { in: ["PENDING_PAYOUT", "SENT_TO_PARTNER"] } },
    _sum: { amount: true },
  });
  const volumeMap = new Map(volumeRows.map((r: { userId: string; _sum: { amount: unknown } }) => [r.userId, Number(r._sum.amount) || 0]));

  res.json(users.map((u: { id: string; email: string; fullName: string | null; createdAt: Date; kycProfile: { tier: number | null } | null; wallets: { status: string } | null; _count: { transfers: number } }) => ({
    id: u.id,
    email: u.email,
    name: u.fullName || u.email,
    status: u.wallets?.status || "ACTIVE",
    kycTier: u.kycProfile?.tier ?? 0,
    totalTransfers: u._count.transfers,
    totalVolume: volumeMap.get(u.id) || 0,
    createdAt: u.createdAt,
  })));
});

router.post("/users/:id/toggle-status", authenticate, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const wallet = await prisma.wallet.findFirst({ where: { userId: user.id } });
  const newStatus = wallet?.status === "FROZEN" ? "ACTIVE" : "FROZEN";

  if (wallet) {
    await prisma.wallet.update({ where: { id: wallet.id }, data: { status: newStatus } });
  }

  await prisma.adminActionLog.create({
    data: {
      adminId: req.userId,
      action: newStatus === "FROZEN" ? "FREEZE_USER" : "ACTIVATE_USER",
      entity: "User",
      entityId: user.id,
    },
  });

  res.json({ status: newStatus });
});

router.get("/kyc/pending", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "COMPLIANCE"), async (_req: AuthRequest, res: Response) => {
  const pending = await prisma.kycProfile.findMany({
    where: { status: { in: ["PENDING", "PENDING_REVIEW", "IN_REVIEW"] } },
    include: {
      user: { select: { email: true, fullName: true, kycTier: true, kycStatus: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const userIds = pending.map((p: any) => p.userId);
  const events = userIds.length > 0
    ? await prisma.kycEvent.findMany({
        where: { userId: { in: userIds } },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const eventMap = new Map<string, any>();
  for (const ev of events) {
    if (!eventMap.has(ev.userId)) {
      eventMap.set(ev.userId, ev);
    }
  }

  res.json(pending.map((p: any) => {
    const ev = eventMap.get(p.userId);
    return {
      id: p.id,
      userId: p.userId,
      email: p.user?.email || "",
      name: p.user?.fullName || p.user?.email || "",
      tier: p.tier,
      status: p.status,
      submittedAt: p.createdAt,
      userKycTier: p.user?.kycTier ?? 0,
      userKycStatus: p.user?.kycStatus ?? "none",
      documents: [],
      lastEvent: ev ? { type: ev.eventType, status: ev.status, payload: ev.rawPayload } : null,
    };
  }));
});

router.get("/kyc/:id", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "COMPLIANCE"), async (req: AuthRequest, res: Response) => {
  const profile = await prisma.kycProfile.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { email: true, fullName: true, kycTier: true, kycStatus: true, createdAt: true } },
    },
  });
  if (!profile) return res.status(404).json({ error: "KYC profile not found" });

  const events = await prisma.kycEvent.findMany({
    where: { userId: profile.userId },
    orderBy: { createdAt: "desc" },
  });

  res.json({ profile, events });
});

router.post("/kyc/:id/approve", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "COMPLIANCE"), async (req: AuthRequest, res: Response) => {
  const profile = await prisma.kycProfile.findUnique({
    where: { id: req.params.id },
    select: { userId: true, tier: true },
  });
  if (!profile) return res.status(404).json({ error: "KYC profile not found" });

  await prisma.kycProfile.update({
    where: { id: req.params.id },
    data: { status: "APPROVED" },
  });

  await prisma.user.update({
    where: { id: profile.userId },
    data: { kycTier: profile.tier, kycStatus: "approved" },
  });

  await prisma.kycEvent.create({
    data: {
      userId: profile.userId,
      eventType: "ADMIN_APPROVE",
      status: "APPROVED",
      provider: "manual",
      rawPayload: { adminId: req.userId },
    },
  });

  await prisma.adminActionLog.create({
    data: {
      adminId: req.userId,
      action: "APPROVE_KYC",
      entity: "KYC",
      entityId: req.params.id,
    },
  });

  res.json({ status: "APPROVED", tier: profile.tier });
});

router.post("/kyc/:id/reject", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "COMPLIANCE"), async (req: AuthRequest, res: Response) => {
  const profile = await prisma.kycProfile.findUnique({
    where: { id: req.params.id },
    select: { userId: true },
  });
  if (!profile) return res.status(404).json({ error: "KYC profile not found" });

  await prisma.kycProfile.update({
    where: { id: req.params.id },
    data: { status: "REJECTED" },
  });

  await prisma.user.update({
    where: { id: profile.userId },
    data: { kycStatus: "rejected" },
  });

  await prisma.kycEvent.create({
    data: {
      userId: profile.userId,
      eventType: "ADMIN_REJECT",
      status: "REJECTED",
      provider: "manual",
      rawPayload: { adminId: req.userId, reason: req.body.reason },
    },
  });

  await prisma.adminActionLog.create({
    data: {
      adminId: req.userId,
      action: "REJECT_KYC",
      entity: "KYC",
      entityId: req.params.id,
      metadata: { reason: req.body.reason },
    },
  });

  res.json({ status: "REJECTED" });
});

router.get("/compliance-cases", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "COMPLIANCE"), async (_req: AuthRequest, res: Response) => {
  const cases = await prisma.complianceCase.findMany({
    include: { user: { select: { email: true, fullName: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(cases);
});

router.post("/compliance-cases/:id/escalate", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "COMPLIANCE"), async (req: AuthRequest, res: Response) => {
  await prisma.complianceCase.update({
    where: { id: req.params.id },
    data: { status: "ESCALATED" },
  });
  res.json({ status: "ESCALATED" });
});

router.get("/payouts/failed", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS", "TREASURY"), async (_req: AuthRequest, res: Response) => {
  const payouts = await prisma.payoutOrder.findMany({
    where: { status: "FAILED" },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { transfer: { select: { referenceId: true, amount: true } } },
  });
  res.json(payouts.map((p: any) => ({
    id: p.id,
    transferId: p.transferId,
    amount: Number(p.transfer?.amount || 0),
    currency: p.currency,
    partner: p.partner,
    status: p.status,
    externalReference: p.externalReference,
    attempts: p.attemptCount,
    referenceId: p.transfer?.referenceId || "",
    createdAt: p.createdAt,
  })));
});

router.get("/payouts/completed", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS", "TREASURY"), async (_req: AuthRequest, res: Response) => {
  const payouts = await prisma.payoutOrder.findMany({
    where: { status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { transfer: { select: { referenceId: true, amount: true } } },
  });
  res.json(payouts.map((p: any) => ({
    id: p.id,
    transferId: p.transferId,
    amount: Number(p.transfer?.amount || 0),
    currency: p.currency,
    partner: p.partner,
    status: p.status,
    externalReference: p.externalReference,
    referenceId: p.transfer?.referenceId || "",
    createdAt: p.createdAt,
  })));
});

router.get("/payouts/:id", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS", "TREASURY"), async (req: AuthRequest, res: Response) => {
  const payout = await prisma.payoutOrder.findUnique({
    where: { id: req.params.id },
    include: {
      transfer: { select: { id: true, referenceId: true, amount: true, fee: true, destinationAmount: true, status: true, payoutMethod: true, createdAt: true, userId: true, processingAgentId: true, proofImage: true, proofMimeType: true, user: { select: { email: true, fullName: true } } } },
      payoutEvents: { orderBy: { createdAt: "desc" }, take: 20 },
      partnerLogs: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!payout) return res.status(404).json({ error: "Payout not found" });

  let agentInfo = null;
  if (payout.transfer?.processingAgentId) {
    const agent = await prisma.agent.findUnique({ where: { id: payout.transfer.processingAgentId }, select: { id: true, email: true, fullName: true, type: true } });
    if (agent) {
      agentInfo = { id: agent.id, email: agent.email, name: agent.fullName || agent.email, type: agent.type };
    }
  }

  res.json({
    id: payout.id,
    transferId: payout.transferId,
    amount: Number(payout.transfer?.amount || 0),
    currency: payout.currency,
    status: payout.status,
    partner: payout.partner,
    payoutMethod: payout.payoutMethod,
    externalReference: payout.externalReference,
    attemptCount: payout.attemptCount,
    createdAt: payout.createdAt,
    updatedAt: payout.updatedAt,
    processingAgent: agentInfo,
    transfer: payout.transfer ? {
      id: payout.transfer.id,
      referenceId: payout.transfer.referenceId,
      amount: Number(payout.transfer.amount),
      fee: Number(payout.transfer.fee || 0),
      destinationAmount: Number(payout.transfer.destinationAmount || 0),
      status: payout.transfer.status,
      payoutMethod: payout.transfer.payoutMethod,
      createdAt: payout.transfer.createdAt,
      userEmail: payout.transfer.user?.email || "",
      userName: payout.transfer.user?.fullName || payout.transfer.user?.email || "System",
      proofImage: payout.transfer.proofImage || null,
      proofMimeType: payout.transfer.proofMimeType || null,
    } : null,
    events: payout.payoutEvents.map((e: any) => ({
      id: e.id,
      eventType: e.eventType,
      payload: e.payload,
      createdAt: e.createdAt,
    })),
    partnerLogs: payout.partnerLogs.map((l: any) => ({
      id: l.id,
      partner: l.partner,
      statusCode: l.statusCode,
      createdAt: l.createdAt,
    })),
  });
});

router.post("/payouts/:id/retry", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS", "TREASURY"), async (req: AuthRequest, res: Response) => {
  const payout = await prisma.payoutOrder.findUnique({ where: { id: req.params.id } });
  if (!payout) return res.status(404).json({ error: "Payout not found" });
  if (payout.attemptCount >= 3) return res.status(400).json({ error: "Max retries reached" });

  await prisma.payoutOrder.update({
    where: { id: req.params.id },
    data: { status: "QUEUED", attemptCount: { increment: 1 } },
  });

  await prisma.adminActionLog.create({
    data: {
      adminId: req.userId,
      action: "RETRY_PAYOUT",
      entity: "Payout",
      entityId: req.params.id,
    },
  });

  res.json({ status: "RETRY_QUEUED" });
});

router.post("/payouts/:id/revert", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS", "TREASURY"), async (req: AuthRequest, res: Response) => {
  const payout = await prisma.payoutOrder.findUnique({ where: { id: req.params.id } });
  if (!payout) return res.status(404).json({ error: "Payout not found" });
  if (payout.status !== "FAILED") return res.status(400).json({ error: "Only failed payouts can be reverted" });

  const transfer = await prisma.transfer.findUnique({ where: { id: payout.transferId } });
  if (!transfer) return res.status(404).json({ error: "Transfer not found" });
  if (transfer.status === "COMPLETED") return res.status(400).json({ error: "Transfer already completed" });

  const wallet = await prisma.wallet.findFirst({ where: { userId: transfer.userId } });
  if (!wallet) return res.status(400).json({ error: "Wallet not found" });

  await ledgerService.credit(wallet.id, Number(transfer.amount), `admin_refund_${payout.id}`);

  await prisma.transfer.update({
    where: { id: transfer.id },
    data: { status: "FAILED" },
  });

  await prisma.walletTransaction.updateMany({
    where: { payoutOrderId: payout.id, walletId: wallet.id },
    data: { status: "FAILED" },
  });

  await prisma.payoutEvent.create({
    data: {
      payoutOrderId: payout.id,
      eventType: "ADMIN_REVERT",
      payload: { adminId: req.userId },
    },
  });

  await prisma.adminActionLog.create({
    data: {
      adminId: req.userId,
      action: "REVERT_PAYOUT",
      entity: "Payout",
      entityId: payout.id,
    },
  });

  res.json({ success: true, message: "Funds reverted to user wallet" });
});

router.get("/notifications", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "COMPLIANCE", "TREASURY", "OPS"), async (_req: AuthRequest, res: Response) => {
  const systemAlerts = await prisma.systemAlert.findMany({
    where: { status: { not: "CLOSED" } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const notifications = systemAlerts.map((alert: { id: string; type: string | null; message: string | null; severity: string; createdAt: Date }) => ({
    id: alert.id,
    type: alert.type || "SYSTEM_INFO",
    title: (alert.type || "System Alert").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
    message: alert.message,
    severity: alert.severity,
    status: "UNREAD" as const,
    createdAt: alert.createdAt,
  }));

  res.json(notifications);
});

router.post("/notifications/:id/read", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "COMPLIANCE", "TREASURY", "OPS"), async (req: AuthRequest, res: Response) => {
  await prisma.systemAlert.update({
    where: { id: req.params.id },
    data: { status: "CLOSED" },
  });
  res.json({ success: true });
});

router.post("/notifications/mark-all-read", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "COMPLIANCE", "TREASURY", "OPS"), async (_req: AuthRequest, res: Response) => {
  await prisma.systemAlert.updateMany({
    where: { status: "OPEN" },
    data: { status: "CLOSED" },
  });
  res.json({ success: true });
});

router.get("/fraud/analyze/:userId", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "COMPLIANCE"), async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.userId },
    include: {
      transfers: { orderBy: { createdAt: "desc" }, take: 5 },
      amlChecks: { orderBy: { createdAt: "desc" }, take: 5 },
      kycProfile: true,
    },
  });

  if (!user) return res.status(404).json({ error: "User not found" });

  const flags: string[] = [];
  let riskScore = 0;

  const recentTransfers = await prisma.transfer.count({
    where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 86400000) } },
  });
  if (recentTransfers > 5) {
    flags.push("HIGH_VELOCITY");
    riskScore += 30;
  }

  if (user.transfers.some((t: { amount: { toString: () => string } }) => Number(t.amount) > 2000)) {
    flags.push("HIGH_VALUE_TRANSFER");
    riskScore += 25;
  }

  if (user.kycProfile?.tier === 1) {
    riskScore += 15;
  }

  res.json({
    userId: user.id,
    riskScore,
    flags,
    recentActivity: user.transfers.map((t: { amount: { toString: () => string }; createdAt: any }) => ({
      action: `Transfer $${Number(t.amount)}`,
      timestamp: t.createdAt,
    })),
  });
});

router.get("/admins", authenticate, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res: Response) => {
  const admins = await prisma.adminUser.findMany({
    select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(admins);
});

router.post("/admins", authenticate, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  const { email, name, password, role } = req.body;
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (!["SUPER_ADMIN", "ADMIN", "COMPLIANCE", "OPS", "TREASURY"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.adminUser.create({
    data: { email, name, passwordHash, role },
    select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
  });

  await prisma.adminActionLog.create({
    data: {
      adminId: req.userId,
      action: "CREATE_ADMIN",
      entity: "AdminUser",
      entityId: admin.id,
      metadata: { email, role },
    },
  });

  res.status(201).json(admin);
});

router.post("/admins/:id/toggle-status", authenticate, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  if (req.params.id === req.userId) return res.status(400).json({ error: "Cannot toggle your own status" });

  const admin = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
  if (!admin) return res.status(404).json({ error: "Admin not found" });

  const newStatus = admin.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  await prisma.adminUser.update({
    where: { id: req.params.id },
    data: { status: newStatus },
  });

  await prisma.adminActionLog.create({
    data: {
      adminId: req.userId,
      action: newStatus === "SUSPENDED" ? "SUSPEND_ADMIN" : "ACTIVATE_ADMIN",
      entity: "AdminUser",
      entityId: req.params.id,
    },
  });

  res.json({ status: newStatus });
});

router.post("/admins/:id/send-reset", authenticate, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  const admin = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
  if (!admin) return res.status(404).json({ error: "Admin not found" });
  if (!admin.email) return res.status(400).json({ error: "Admin has no email" });

  const resetToken = jwt.sign(
    { adminId: admin.id, type: "password-reset" },
    ENV.JWT_SECRET,
    { expiresIn: "1h" },
  );

  const resetLink = `${ENV.ADMIN_APP_URL}/reset-password?token=${resetToken}`;

  const html = `
    <h2>Password Reset</h2>
    <p>Hello ${admin.name || admin.email},</p>
    <p>A password reset was requested for your Quick Send admin account.</p>
    <p><a href="${resetLink}">Click here to reset your password</a></p>
    <p>This link expires in 1 hour.</p>
    <p>If you did not request this, you can safely ignore this email.</p>
  `;

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(ENV.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: ENV.EMAIL_FROM,
      to: admin.email,
      subject: "Quick Send Admin — Password Reset",
      html,
    });
    if (error) throw new Error(error.message);
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to send email: ${err.message}` });
  }

  await prisma.adminActionLog.create({
    data: {
      adminId: req.userId,
      action: "SEND_RESET_EMAIL",
      entity: "AdminUser",
      entityId: req.params.id,
      metadata: { email: admin.email },
    },
  });

  res.json({ success: true, message: "Reset email sent" });
});

router.post("/reset-password", async (req: AuthRequest, res: Response) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "token and password are required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  let decoded: { adminId: string; type: string };
  try {
    decoded = jwt.verify(token, ENV.JWT_SECRET) as { adminId: string; type: string };
    if (decoded.type !== "password-reset") return res.status(400).json({ error: "Invalid token type" });
  } catch {
    return res.status(400).json({ error: "Invalid or expired token" });
  }

  const admin = await prisma.adminUser.findUnique({ where: { id: decoded.adminId } });
  if (!admin) return res.status(404).json({ error: "Admin not found" });

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.adminUser.update({
    where: { id: decoded.adminId },
    data: { passwordHash },
  });

  res.json({ success: true, message: "Password updated successfully" });
});

router.put("/admins/:id", authenticate, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  const { name, role, email, password } = req.body;
  const validRoles = ["SUPER_ADMIN", "ADMIN", "COMPLIANCE", "OPS", "TREASURY"];

  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  if (password && password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const admin = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
  if (!admin) return res.status(404).json({ error: "Admin not found" });

  if (email && email !== admin.email) {
    const existing = await prisma.adminUser.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "Email already in use" });
  }

  const updated = await prisma.adminUser.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(role !== undefined && { role }),
      ...(email !== undefined && { email }),
      ...(password !== undefined && { passwordHash: await bcrypt.hash(password, 12) }),
    },
    select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
  });

  await prisma.adminActionLog.create({
    data: {
      adminId: req.userId,
      action: "UPDATE_ADMIN",
      entity: "AdminUser",
      entityId: req.params.id,
      metadata: { changes: { ...req.body, password: password ? "***" : undefined } },
    },
  });

  res.json(updated);
});

router.delete("/admins/:id", authenticate, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  if (req.params.id === req.userId) return res.status(400).json({ error: "Cannot delete your own account" });

  const admin = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
  if (!admin) return res.status(404).json({ error: "Admin not found" });

  await prisma.adminUser.delete({ where: { id: req.params.id } });

  await prisma.adminActionLog.create({
    data: {
      adminId: req.userId,
      action: "DELETE_ADMIN",
      entity: "AdminUser",
      entityId: req.params.id,
      metadata: { email: admin.email, role: admin.role },
    },
  });

  res.json({ success: true });
});

router.get("/transfers", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS", "TREASURY"), async (_req: AuthRequest, res: Response) => {
  const transfers = await prisma.transfer.findMany({
    include: {
      user: { select: { email: true, fullName: true } },
      payoutOrder: { select: { status: true, externalReference: true, partner: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const beneficiaryIds = (transfers as any[]).filter((t: any) => t.beneficiaryId).map((t: any) => t.beneficiaryId as string);
  const beneficiaries = beneficiaryIds.length > 0
    ? await prisma.beneficiary.findMany({ where: { id: { in: beneficiaryIds } } })
    : [];
  const beneficiaryMap = new Map<string, { country: string }>((beneficiaries as any[]).map((b: any) => [b.id, { country: b.country }]));

  const feeRules = await prisma.feeRule.findMany();
  const feeRuleMap = new Map<string, { fixed: number; percent: number }>();
  for (const r of feeRules) {
    feeRuleMap.set(`${r.country}:${r.payoutMethod}`, { fixed: Number(r.fixedFee), percent: Number(r.percentFee) });
  }

  res.json(transfers.map((t: any) => {
    const beneficiary = t.beneficiaryId ? beneficiaryMap.get(t.beneficiaryId) : null;
    const country = beneficiary?.country || "";
    const rule = feeRuleMap.get(`${country}:${t.payoutMethod}`);
    const computedFee = rule
      ? rule.fixed + (Number(t.amount) * rule.percent / 100)
      : 2 + (Number(t.amount) * 0.01);

    const fee = t.fee != null ? Number(t.fee) : computedFee;
    const destAmt = t.destinationAmount != null ? Number(t.destinationAmount) : (Number(t.amount) - fee);

    return {
      id: t.id,
      userId: t.userId,
      userEmail: t.user?.email || "",
      userName: t.user?.fullName || t.user?.email || "System",
      amount: Number(t.amount),
      fee,
      destinationAmount: destAmt,
      payoutMethod: t.payoutMethod,
      status: t.status,
      referenceId: t.referenceId,
      partner: t.payoutOrder?.partner || null,
      partnerStatus: t.payoutOrder?.status || null,
      createdAt: t.createdAt,
    };
  }));
});

router.get("/audit-logs", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "COMPLIANCE", "OPS"), async (_req: AuthRequest, res: Response) => {
  const logs = await prisma.adminActionLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  res.json(logs.map((l: any) => ({
    id: l.id,
    adminId: l.adminId,
    action: l.action,
    entity: l.entity,
    entityId: l.entityId,
    metadata: l.metadata,
    createdAt: l.createdAt,
  })));
});

// --- Admin Cash Requests & Settlements ---

router.get("/cash-requests", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS", "TREASURY"), async (_req: AuthRequest, res: Response) => {
  try {
    const requests = await prisma.agentCashRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { agent: { select: { id: true, name: true, email: true, type: true } } },
    });
    res.json(requests);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/settlements", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS", "TREASURY"), async (_req: AuthRequest, res: Response) => {
  try {
    const settlements = await prisma.agentSettlement.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { agent: { select: { id: true, name: true, email: true, type: true } }, cashRequest: true },
    });
    res.json(settlements);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// --- Admin Cash Request Processing ---

router.post("/cash-requests/:id/process", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS", "TREASURY"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!["PROCESSING", "DELIVERED", "REJECTED"].includes(status)) {
      res.status(400).json({ error: "Invalid status. Must be PROCESSING, DELIVERED, or REJECTED" });
      return;
    }

    const cashRequest = await prisma.agentCashRequest.findUnique({ where: { id } });
    if (!cashRequest) { res.status(404).json({ error: "Cash request not found" }); return; }

    const updated = await prisma.agentCashRequest.update({
      where: { id },
      data: { status },
    });

    await prisma.agentTransaction.updateMany({
      where: { metadata: { path: "$.cashRequestId", equals: id }, type: "CASH_REQUEST" },
      data: { status },
    });

    await prisma.adminActionLog.create({
      data: {
        adminId: req.userId!,
        action: "UPDATE_CASH_REQUEST_STATUS",
        entity: "AgentCashRequest",
        entityId: id,
        metadata: { previousStatus: cashRequest.status, newStatus: status },
      },
    });

    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// --- Admin Settlement Processing ---

router.post("/settlements/:id/process", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS", "TREASURY"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!["APPROVED", "REJECTED"].includes(status)) {
      res.status(400).json({ error: "Invalid status. Must be APPROVED or REJECTED" });
      return;
    }

    const settlement = await prisma.agentSettlement.findUnique({ where: { id } });
    if (!settlement) { res.status(404).json({ error: "Settlement not found" }); return; }

    const updated = await prisma.agentSettlement.update({
      where: { id },
      data: { status },
    });

    await prisma.agentTransaction.updateMany({
      where: { metadata: { path: "$.settlementId", equals: id }, type: "SETTLEMENT" },
      data: { status },
    });

    await prisma.adminActionLog.create({
      data: {
        adminId: req.userId!,
        action: "UPDATE_SETTLEMENT_STATUS",
        entity: "AgentSettlement",
        entityId: id,
        metadata: { previousStatus: settlement.status, newStatus: status },
      },
    });

    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export { router as adminRoutes };
