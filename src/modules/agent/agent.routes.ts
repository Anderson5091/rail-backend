import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest, requireRole } from "../../middleware/auth";
import { agentService } from "./agent.service";
import { agentLedgerService } from "./agent-ledger.service";
import { generateReferenceNumber } from "../../utils/id-generator";
import { crossmintService } from "../../services/crossmint.service";
import { ledgerService } from "../ledger/ledger.service";
import { fxService } from "../fx/fx.service";
import type { ChainType } from "../../services/crossmint.service";

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
  const chain = "base" as ChainType;

  let crossmintWallet;
  try {
    const alias = `agent_wallet_${agent.id}`;
    crossmintWallet = await crossmintService.createWallet(chain, "AGENT", agent.id, alias);
  } catch (error) {
    await prisma.agent.delete({ where: { id: agent.id } });
    throw error;
  }

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
    ledgerBalance: 0,
    totalTransactions: 0,
    kpiRating: null,
    createdAt: agent.createdAt,
  });
});

router.get("/pending-transfers", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  try {
    const currentAgentId = req.userId;
    const transfers = await prisma.transfer.findMany({
      where: {
        status: { in: ["PENDING_PAYOUT", "PROCESSING"] },
        OR: [
          { processingAgentId: null },
          { processingAgentId: currentAgentId }
        ]
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    res.json(transfers.map((t: any) => ({
      id: t.id,
      amount: Number(t.amount),
      fee: Number(t.fee || 0),
      destinationAmount: Number(t.destinationAmount || 0),
      payoutMethod: t.payoutMethod,
      currency: t.currency,
      status: t.status,
      referenceId: t.referenceId,
      processingAgentId: t.processingAgentId,
      isMine: t.processingAgentId === currentAgentId,
      isAvailable: t.processingAgentId === null,
      createdAt: t.createdAt,
    })));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch pending transfers";
    res.status(400).json({ error: message });
  }
});

router.get("/pending-transfer/:referenceId", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  try {
    const transfer = await prisma.transfer.findFirst({
      where: { referenceId: req.params.referenceId },
      include: { user: { select: { id: true, email: true, fullName: true, phone: true } } },
    });

    if (!transfer) {
      return res.status(404).json({ error: "Transfer not found" });
    }

    let beneficiary = null;
    if (transfer.beneficiaryId) {
      beneficiary = await prisma.beneficiary.findUnique({
        where: { id: transfer.beneficiaryId },
      });
    }

    res.json({
      id: transfer.id,
      referenceId: transfer.referenceId,
      amount: Number(transfer.amount),
      fee: Number(transfer.fee || 0),
      destinationAmount: Number(transfer.destinationAmount || 0),
      payoutMethod: transfer.payoutMethod,
      currency: transfer.currency,
      status: transfer.status,
      processingAgentId: transfer.processingAgentId,
      createdAt: transfer.createdAt,
      sender: transfer.user,
      beneficiary: beneficiary ? {
        id: beneficiary.id,
        fullName: beneficiary.fullName,
        country: beneficiary.country,
        bankName: beneficiary.bankName,
        accountNumber: beneficiary.accountNumber,
        accountCurrency: beneficiary.accountCurrency,
        mobileWalletNumber: beneficiary.mobileWalletNumber,
        mobileProvider: beneficiary.mobileProvider,
        cashPickupLocation: beneficiary.cashPickupLocation,
      } : null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch transfer detail";
    res.status(400).json({ error: message });
  }
});

router.get("/list", authenticate, requireRole("SUPER_ADMIN", "OPS", "TREASURY"), async (_req: AuthRequest, res: Response) => {
  const agents = await prisma.agent.findMany({
    include: {
      wallets: true,
      ledgerEntries: true,
      _count: { select: { transactions: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(
    agents.map((a: { id: string; email: string; fullName: string | null; type: string; status: string; kpiRating: number | null; totalRewards: { toString: () => string }; _count: { transactions: number }; wallets: { walletType: string; balance: { toString: () => string } }[]; ledgerEntries: { type: string; amount: { toString: () => string } }[]; createdAt: Date }) => {
      const ledgerBalance = a.ledgerEntries.reduce((sum: number, e: { type: string; amount: { toString: () => string } }) => {
        return e.type === "CREDIT" ? sum + Number(e.amount) : sum - Number(e.amount);
      }, 0);

      return {
        id: a.id,
        email: a.email,
        fullName: a.fullName,
        type: a.type,
        status: a.status,
        kpiRating: a.kpiRating,
        totalRewards: Number(a.totalRewards),
        totalTransactions: a._count.transactions,
        walletBalance: Number(a.wallets.find((w: { walletType: string }) => w.walletType === "MAIN" || w.walletType === "BASE_TREASURY")?.balance ?? 0),
        ledgerBalance,
        createdAt: a.createdAt,
      };
    })
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
  try {
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to add balance";
    res.status(400).json({ error: message });
  }
});

router.post("/:id/withdraw", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, amount, commissionPercent, destinationType } = req.body;
    if (!userId || !amount) {
      return res.status(400).json({ error: "userId and amount are required" });
    }

    const result = await agentService.executeWithdrawal(
      String(req.params.id),
      userId,
      amount,
      commissionPercent || 0,
      destinationType
    );
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Withdrawal failed";
    res.status(400).json({ error: message });
  }
});

router.post("/topup-partner", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS", "TREASURY", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  try {
    const { partnerAgentId, usdtAmount } = req.body;
    if (!partnerAgentId || !usdtAmount) {
      return res.status(400).json({ error: "partnerAgentId and usdtAmount are required" });
    }

    const result = await agentService.topUpPartnerBalance(
      req.userId!,
      partnerAgentId,
      usdtAmount,
      req.userRole
    );
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Top-up failed";
    res.status(400).json({ error: message });
  }
});

router.post("/:id/transfer", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, amount, payoutMethod, beneficiaryId, beneficiary, commissionPercent, accountCurrency, debitUserWallet } = req.body;
    if (!amount || !payoutMethod) {
      return res.status(400).json({ error: "amount, and payoutMethod are required" });
    }
    if (!beneficiaryId && !beneficiary) {
      return res.status(400).json({ error: "beneficiaryId or beneficiary details are required" });
    }

    let beneficiaryCountry = beneficiary?.country;
    if (!beneficiaryCountry && beneficiaryId) {
      const existing = await prisma.beneficiary.findUnique({ where: { id: beneficiaryId } });
      beneficiaryCountry = existing?.country;
    }
    const currency = await fxService.resolveCurrency(beneficiaryCountry || "US", payoutMethod, accountCurrency);

    const result = await agentService.processTransfer(String(req.params.id), {
      userId: userId || undefined,
      amount: Number(amount),
      payoutMethod,
      beneficiaryId: beneficiaryId || undefined,
      beneficiary,
      commissionPercent: Number(commissionPercent || 0),
      currency,
      debitUserWallet: !!debitUserWallet,
    });

    res.json(result.agentTx);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Transfer failed";
    console.error("[AGENT_TRANSFER] Error:", err);
    res.status(400).json({ error: message });
  }
});

router.post("/:id/process-payout", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, amount, payoutMethod, beneficiaryId, commissionPercent, accountCurrency } = req.body;
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
      await agentLedgerService.credit(agentId, commission, "COMMISSION", `payout_commission_${agentId}_${Date.now()}`, `Payout commission for user ${userId}`);
    }

    let benCountry: string | undefined;
    if (beneficiaryId) {
      const ben = await prisma.beneficiary.findUnique({ where: { id: beneficiaryId } });
      benCountry = ben?.country;
    }
    const destCurrency = await fxService.resolveCurrency(benCountry || "US", payoutMethod, accountCurrency);
    const transfer = await prisma.transfer.create({
      data: {
        userId,
        beneficiaryId: beneficiaryId || null,
        amount: netAmount,
        payoutMethod,
        currency: destCurrency,
        status: "PENDING_PAYOUT",
        referenceId: generateReferenceNumber(),
      },
    });

    const payoutOrder = await prisma.payoutOrder.create({
      data: {
        transferId: transfer.id,
        payoutMethod,
        currency: destCurrency,
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
        reference: generateReferenceNumber(),
        metadata: { payoutMethod, beneficiaryId },
      },
    });

    await agentService.recordKpi(agentId, Number(amount), commission);

    res.json(agentTx);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Payout failed";
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

router.get("/:id/recent-deposits", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  try {
    const deposits = await prisma.agentTransaction.findMany({
      where: { agentId: String(req.params.id), type: "ADD_BALANCE" },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const userIds = deposits.map((d: any) => d.userRef).filter(Boolean) as string[];
    const users = userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, fullName: true, phone: true },
        })
      : [];
    const userMap = new Map<string, { id: string; email: string; fullName: string | null; phone: string | null }>(
      users.map((u: { id: string; email: string; fullName: string | null; phone: string | null }) => [u.id, u])
    );

    res.json(deposits.map((d: any) => {
      const u = userMap.get(d.userRef);
      return {
        id: d.id,
        amount: Number(d.amount),
        netAmount: Number(d.netAmount),
        commission: Number(d.commission),
        userRef: d.userRef,
        reference: d.reference,
        user: u ? { fullName: u.fullName, email: u.email, phone: u.phone } : null,
        createdAt: d.createdAt,
      };
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch recent deposits";
    res.status(400).json({ error: message });
  }
});

router.get("/:id/recent-withdrawals", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  try {
    const withdrawals = await prisma.agentTransaction.findMany({
      where: { agentId: String(req.params.id), type: "WITHDRAW" },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const userIds = withdrawals.map((d: any) => d.userRef).filter(Boolean) as string[];
    const users = userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, fullName: true, phone: true },
        })
      : [];
    const userMap = new Map<string, { id: string; email: string; fullName: string | null; phone: string | null }>(
      users.map((u: { id: string; email: string; fullName: string | null; phone: string | null }) => [u.id, u])
    );

    res.json(withdrawals.map((d: any) => {
      const u = userMap.get(d.userRef);
      return {
        id: d.id,
        amount: Number(d.amount),
        netAmount: Number(d.netAmount),
        commission: Number(d.commission),
        userRef: d.userRef,
        reference: d.reference,
        metadata: d.metadata,
        user: u ? { fullName: u.fullName, email: u.email, phone: u.phone } : null,
        createdAt: d.createdAt,
      };
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch recent withdrawals";
    res.status(400).json({ error: message });
  }
});

router.post("/:id/claim-transfer", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  try {
    const { transferId } = req.body;
    if (!transferId) return res.status(400).json({ error: "transferId is required" });

    const agentId = String(req.params.id);
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const transfer = await prisma.transfer.findUnique({ where: { id: transferId } });
    if (!transfer) return res.status(404).json({ error: "Transfer not found" });
    if (transfer.status !== "PENDING_PAYOUT") return res.status(400).json({ error: "Transfer is not in PENDING_PAYOUT status" });
    if (transfer.processingAgentId && transfer.processingAgentId !== agentId) {
      return res.status(409).json({ error: "Transfer already claimed by another agent" });
    }

    await prisma.transfer.update({
      where: { id: transferId },
      data: { status: "PROCESSING", processingAgentId: agentId },
    });

    res.json({ success: true, message: "Transfer claimed successfully", transferId, status: "PROCESSING" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to claim transfer";
    res.status(400).json({ error: message });
  }
});

router.post("/:id/execute-payout", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  try {
    const { transferId } = req.body;
    if (!transferId) return res.status(400).json({ error: "transferId is required" });

    const transfer = await prisma.transfer.findUnique({ where: { id: transferId } });
    if (!transfer) return res.status(404).json({ error: "Transfer not found" });
    if (transfer.status !== "PENDING_PAYOUT") return res.status(400).json({ error: "Transfer is not in PENDING_PAYOUT status" });

    const agentId = String(req.params.id);
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    await prisma.transfer.update({
      where: { id: transferId },
      data: { status: "PROCESSING", processingAgentId: agentId },
    });

    res.json({ success: true, message: "Payout processing — deliver funds manually and upload proof", transferId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to execute payout";
    res.status(400).json({ error: message });
  }
});

router.post("/:id/cancel-payout", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  try {
    const { transferId } = req.body;
    if (!transferId) return res.status(400).json({ error: "transferId is required" });

    const transfer = await prisma.transfer.findUnique({ where: { id: transferId } });
    if (!transfer) return res.status(404).json({ error: "Transfer not found" });
    if (transfer.status !== "PROCESSING") return res.status(400).json({ error: "Transfer is not in PROCESSING status" });

    const agentId = String(req.params.id);
    if (transfer.processingAgentId && transfer.processingAgentId !== agentId) {
      return res.status(403).json({ error: "This transfer is being processed by another agent" });
    }

    await prisma.transfer.update({
      where: { id: transferId },
      data: { status: "PENDING_PAYOUT", processingAgentId: null },
    });

    res.json({ success: true, message: "Payout cancelled, transfer returned to pending pool", transferId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to cancel payout";
    res.status(400).json({ error: message });
  }
});

router.post("/:id/swap", authenticate, requireRole("AGENT_PARTNER"), async (req: AuthRequest, res: Response) => {
  try {
    const { amount, direction } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "amount is required and must be greater than 0" });
    }
    if (!direction || !["TO_LEDGER", "TO_WALLET"].includes(direction)) {
      return res.status(400).json({ error: "direction must be TO_LEDGER or TO_WALLET" });
    }

    const result = await agentService.swapFunds(String(req.params.id), Number(amount), direction);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Swap failed";
    res.status(400).json({ error: message });
  }
});

router.post("/:id/confirm-payout", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  try {
    const { transferId, proofImage, proofMimeType } = req.body;
    if (!transferId || !proofImage) {
      return res.status(400).json({ error: "transferId and proofImage are required" });
    }

    const transfer = await prisma.transfer.findUnique({ where: { id: transferId } });
    if (!transfer) return res.status(404).json({ error: "Transfer not found" });
    if (transfer.status !== "PROCESSING") return res.status(400).json({ error: "Transfer is not in PROCESSING status" });

    const agentId = String(req.params.id);
    if (transfer.processingAgentId && transfer.processingAgentId !== agentId) {
      return res.status(403).json({ error: "This transfer is being processed by another agent" });
    }

    await prisma.transfer.update({
      where: { id: transferId },
      data: {
        status: "COMPLETED",
        proofImage,
        proofMimeType: proofMimeType || "image/jpeg",
        completedAt: new Date(),
      },
    });

    await prisma.payoutOrder.update({
      where: { transferId },
      data: { status: "COMPLETED" },
    });

    res.json({ success: true, message: "Payout confirmed and completed", transferId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to confirm payout";
    res.status(400).json({ error: message });
  }
});

router.post("/lookup-user", authenticate, requireRole("AGENT_PARTNER", "AGENT_INTERNAL"), async (req: AuthRequest, res: Response) => {
  try {
    const { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({ error: "identifier is required" });
    }

    const user = await agentService.lookupUser(identifier);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to look up user";
    res.status(400).json({ error: message });
  }
});

export { router as agentRoutes };
