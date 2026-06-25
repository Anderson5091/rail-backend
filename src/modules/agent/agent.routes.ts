import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest, requireRole } from "../../middleware/auth";
import { agentService } from "./agent.service";
import { crossmintService } from "../../services/crossmint.service";
import { PayoutOrchestrator } from "../payout/payout.orchestrator";
import { ledgerService } from "../ledger/ledger.service";
import type { ChainType } from "../../services/crossmint.service";

const router = Router();
const payoutOrchestrator = new PayoutOrchestrator();

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
  const chain = "base" as ChainType;

  try {
    const alias = `agent_wallet_${agent.id}`;
    const crossmintWallet = await crossmintService.createWallet(chain, "AGENT", agent.id, alias);

    await prisma.agentWallet.create({
      data: {
        agentId: agent.id,
        walletType: "MAIN",
        network,
        chain,
        address: crossmintWallet.address,
        crossmintWalletId: crossmintWallet.crossmintWalletId,
        walletLocator: crossmintWallet.walletLocator,
        balance: 0,
      },
    });
  } catch (error) {
    await prisma.agentWallet.create({
      data: {
        agentId: agent.id,
        walletType: "MAIN",
        network,
        chain,
        address: `wallet_${agent.id}`,
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
    walletBalance: 0,
    commissionLedgerBalance: 0,
    totalTransactions: 0,
    kpiRating: null,
    createdAt: agent.createdAt,
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
    agents.map((a: { id: string; email: string; fullName: string | null; type: string; status: string; kpiRating: number | null; totalRewards: { toString: () => string }; commissionLedger: { toString: () => string }; _count: { transactions: number }; wallets: { walletType: string; balance: { toString: () => string } }[]; createdAt: Date }) => ({
      id: a.id,
      email: a.email,
      fullName: a.fullName,
      type: a.type,
      status: a.status,
      kpiRating: a.kpiRating,
      totalRewards: Number(a.totalRewards),
      totalTransactions: a._count.transactions,
      walletBalance: Number(a.wallets.find((w: { walletType: string }) => w.walletType === "MAIN")?.balance ?? 0),
      commissionLedgerBalance: Number(a.commissionLedger),
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

router.post("/:id/upgrade-wallet", authenticate, requireRole("SUPER_ADMIN", "OPS"), async (req: AuthRequest, res: Response) => {
  try {
    const result = await agentService.upgradeAgentWallet(String(req.params.id));
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Upgrade failed";
    res.status(400).json({ error: message });
  }
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

router.post("/:id/transfer", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, amount, payoutMethod, beneficiaryId, beneficiary, commissionPercent } = req.body;
    if (!amount || !payoutMethod) {
      return res.status(400).json({ error: "amount, and payoutMethod are required" });
    }
    if (!beneficiaryId && !beneficiary) {
      return res.status(400).json({ error: "beneficiaryId or beneficiary details are required" });
    }

    const result = await agentService.processTransfer(String(req.params.id), {
      userId: userId || undefined,
      amount: Number(amount),
      payoutMethod,
      beneficiaryId: beneficiaryId || undefined,
      beneficiary,
      commissionPercent: Number(commissionPercent || 0),
    });

    payoutOrchestrator.execute({
      id: result.transfer.id,
      payoutMethod,
      amount: Number(result.transfer.amount),
      beneficiaryId: result.transfer.beneficiaryId,
    }).catch((err: Error) => {
      console.error(`[AGENT_TRANSFER] Auto-payout failed for transfer ${result.transfer.id}:`, err.message);
    });

    res.json(result.agentTx);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Transfer failed";
    console.error("[AGENT_TRANSFER] Error:", err);
    res.status(400).json({ error: message });
  }
});

router.post("/:id/process-payout", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  const { userId, amount, payoutMethod, beneficiaryId, commissionPercent } = req.body;
  if (!userId || !amount || !payoutMethod) {
    return res.status(400).json({ error: "userId, amount, and payoutMethod are required" });
  }

  const agentId = String(req.params.id);
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const wallet = await prisma.wallet.findFirst({ where: { userId } });
  if (!wallet) return res.status(400).json({ error: "User wallet not found" });

  const balance = await ledgerService.getBalance(wallet.id);
  if (balance < Number(amount)) return res.status(400).json({ error: "Insufficient user balance" });

  const commission = (Number(amount) * Number(commissionPercent || 0)) / 100;
  const netAmount = Number(amount) - commission;

  await ledgerService.debit(wallet.id, Number(amount), `agent_payout_${agentId}_${Date.now()}`);

  if (commission > 0) {
    await prisma.agent.update({
      where: { id: agentId },
      data: { commissionLedger: { increment: commission } },
    });
  }

  const transfer = await prisma.transfer.create({
    data: {
      userId,
      beneficiaryId: beneficiaryId || null,
      amount: netAmount,
      payoutMethod,
      status: "PENDING_PAYOUT",
      referenceId: `ap_${agentId}_${Date.now()}`,
    },
  });

  const payoutOrder = await prisma.payoutOrder.create({
    data: {
      transferId: transfer.id,
      payoutMethod,
      status: "PENDING",
    },
  });

  await prisma.transfer.update({
    where: { id: transfer.id },
    data: { payoutOrderId: payoutOrder.id },
  });

  await prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: "AGENT_PAYOUT",
      amount: netAmount,
      status: "PENDING",
      payoutOrderId: payoutOrder.id,
    },
  });

  const agentTx = await prisma.agentTransaction.create({
    data: {
      agentId,
      type: "PAYOUT",
      amount: Number(amount),
      commission,
      netAmount,
      userRef: userId,
      status: "COMPLETED",
      reference: `ap_${agentId}_${Date.now()}`,
      metadata: { payoutMethod, beneficiaryId },
    },
  });

  await agentService.recordKpi(agentId, Number(amount), commission);

  payoutOrchestrator.execute({ id: transfer.id, payoutMethod, amount: netAmount, beneficiaryId }).catch((err) => {
    console.error(`[AGENT_PAYOUT] Auto-payout failed for transfer ${transfer.id}:`, err.message);
  });

  res.json(agentTx);
});

router.post("/:id/withdraw-commission", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  try {
    const result = await agentService.withdrawCommission(String(req.params.id));
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to withdraw commission";
    res.status(400).json({ error: message });
  }
});

router.get("/kpi/:id/", authenticate, async (req: AuthRequest, res: Response) => {
  const { period } = req.query;
  const kpi = await agentService.getAgentKpi(
    String(req.params.id),
    period as string | undefined
  );
  res.json(kpi);
});

router.get("/me/dashboard", authenticate, async (req: AuthRequest, res: Response) => {
  const dashboard = await agentService.getAgentDashboard(req.userId!);
  res.json(dashboard);
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
