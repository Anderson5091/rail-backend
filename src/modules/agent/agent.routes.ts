import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest, requireRole } from "../../middleware/auth";
import { agentService } from "./agent.service";

const router = Router();

router.post("/create", authenticate, requireRole("SUPER_ADMIN", "OPS"), async (req: AuthRequest, res: Response) => {
  const { email, password, fullName, phone, type } = req.body;

  if (!email || !password || !type) {
    return res.status(400).json({ error: "email, password, and type are required" });
  }
  if (!["PARTNER", "INTERNAL"].includes(type)) {
    return res.status(400).json({ error: "type must be PARTNER or INTERNAL" });
  }

  const existing = await prisma.agent.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(password, 12);

  const agent = await prisma.agent.create({
    data: {
      email,
      passwordHash,
      fullName: fullName || null,
      phone: phone || null,
      type,
      status: "ACTIVE",
      createdBy: req.userId,
    },
  });

  const network = "BASE";
  const chain = "base";

  if (type === "PARTNER") {
    await prisma.agentWallet.createMany({
      data: [
        {
          agentId: agent.id,
          walletType: "BASE_TREASURY",
          network,
          chain,
          address: `agent_base_treasury_${agent.id}`,
          balance: 0,
        },
        {
          agentId: agent.id,
          walletType: "COMMISSION",
          network,
          chain,
          address: `agent_commission_${agent.id}`,
          balance: 0,
        },
      ],
    });
  } else {
    await prisma.agentWallet.create({
      data: {
        agentId: agent.id,
        walletType: "COMMISSION",
        network,
        chain,
        address: `agent_commission_${agent.id}`,
        balance: 0,
      },
    });
  }

  await prisma.adminActionLog.create({
    data: {
      adminId: req.userId,
      action: "CREATE_AGENT",
      entity: "Agent",
      entityId: agent.id,
      metadata: { type, email },
    },
  });

  res.status(201).json({
    id: agent.id,
    email: agent.email,
    fullName: agent.fullName,
    type: agent.type,
    status: agent.status,
  });
});

router.get("/list", authenticate, requireRole("SUPER_ADMIN", "OPS", "TREASURY"), async (_req: AuthRequest, res: Response) => {
  const agents = await prisma.agent.findMany({
    include: {
      wallets: true,
      _count: { select: { transactions: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(
    agents.map((a: { id: string; email: string; fullName: string | null; type: string; status: string; kpiRating: number | null; totalRewards: { toString: () => string }; _count: { transactions: number }; wallets: { walletType: string; balance: { toString: () => string } }[]; createdAt: Date }) => ({
      id: a.id,
      email: a.email,
      fullName: a.fullName,
      type: a.type,
      status: a.status,
      kpiRating: a.kpiRating,
      totalRewards: Number(a.totalRewards),
      totalTransactions: a._count.transactions,
      baseTreasuryBalance: Number(a.wallets.find((w: { walletType: string }) => w.walletType === "BASE_TREASURY")?.balance ?? 0),
      commissionBalance: Number(a.wallets.find((w: { walletType: string }) => w.walletType === "COMMISSION")?.balance ?? 0),
      createdAt: a.createdAt,
    }))
  );
});

router.get("/:id", authenticate, requireRole("SUPER_ADMIN", "OPS", "TREASURY"), async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const dashboard = await agentService.getAgentDashboard(id);
  res.json(dashboard);
});

router.post("/:id/toggle-status", authenticate, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const newStatus = agent.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  await prisma.agent.update({
    where: { id },
    data: { status: newStatus },
  });

  await prisma.adminActionLog.create({
    data: {
      adminId: req.userId,
      action: newStatus === "SUSPENDED" ? "SUSPEND_AGENT" : "ACTIVATE_AGENT",
      entity: "Agent",
      entityId: id,
    },
  });

  res.json({ status: newStatus });
});

router.post("/:id/add-balance", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  const { userId, fiatAmount, usdtAmount, commissionPercent } = req.body;
  if (!userId || !fiatAmount || !usdtAmount) {
    return res.status(400).json({ error: "userId, fiatAmount, and usdtAmount are required" });
  }

  const result = await agentService.addUserBalance(
    String(req.params.id),
    userId,
    fiatAmount,
    usdtAmount,
    commissionPercent || 0
  );
  res.json(result);
});

router.post("/:id/withdraw", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  const { userId, amount, destinationAddress, commissionPercent } = req.body;
  if (!userId || !amount || !destinationAddress) {
    return res.status(400).json({ error: "userId, amount, and destinationAddress are required" });
  }

  const result = await agentService.executeWithdrawal(
    String(req.params.id),
    userId,
    amount,
    destinationAddress,
    commissionPercent || 0
  );
  res.json(result);
});

router.post("/:id/process-payment", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  const { userId, amount, paymentMethod, commissionPercent } = req.body;
  if (!userId || !amount || !paymentMethod) {
    return res.status(400).json({ error: "userId, amount, and paymentMethod are required" });
  }

  const result = await agentService.processGlobalPayment(
    String(req.params.id),
    userId,
    amount,
    paymentMethod,
    commissionPercent || 0
  );
  res.json(result);
});

router.post("/topup-partner", authenticate, requireRole("AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  const { partnerAgentId, usdtAmount } = req.body;
  if (!partnerAgentId || !usdtAmount) {
    return res.status(400).json({ error: "partnerAgentId and usdtAmount are required" });
  }

  const result = await agentService.topUpPartnerBalance(
    req.userId!,
    partnerAgentId,
    usdtAmount
  );
  res.json(result);
});

router.get("/:id/kpi", authenticate, async (req: AuthRequest, res: Response) => {
  const { period } = req.query;
  const kpi = await agentService.getAgentKpi(
    String(req.params.id),
    period as string | undefined
  );
  res.json(kpi);
});

router.get("/:id/transactions", authenticate, async (req: AuthRequest, res: Response) => {
  const transactions = await prisma.agentTransaction.findMany({
    where: { agentId: String(req.params.id) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  res.json(
    transactions.map((t: { id: string; type: string; amount: { toString: () => string }; commission: { toString: () => string }; netAmount: { toString: () => string }; userRef: string | null; status: string; reference: string | null; createdAt: Date }) => ({
      id: t.id,
      type: t.type,
      amount: Number(t.amount),
      commission: Number(t.commission),
      netAmount: Number(t.netAmount),
      userRef: t.userRef,
      status: t.status,
      reference: t.reference,
      createdAt: t.createdAt,
    }))
  );
});

export { router as agentRoutes };
