import { z } from "zod";
import { Router, Response } from "express";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { depositService } from "../deposit/deposit.service";
import { ENV } from "../../config/env";
import { ledgerService } from "../ledger/ledger.service";
import { feeService } from "../fees/fee.service";
import { lockService } from "../../services/lock.service";
import { generateTransactionNumber } from "../../utils/id-generator";

const router = Router();

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  let wallet = await prisma.wallet.findFirst({
    where: { userId: req.userId },
  });

  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: { userId: req.userId! },
    });
  }

  const credits = await prisma.ledgerEntry.aggregate({
    where: { walletId: wallet.id, type: "CREDIT" },
    _sum: { amount: true },
  });

  const debits = await prisma.ledgerEntry.aggregate({
    where: { walletId: wallet.id, type: "DEBIT" },
    _sum: { amount: true },
  });

  const availableBalance = Number(credits._sum.amount || 0) - Number(debits._sum.amount || 0);

  const pendingOut = await prisma.walletTransaction.aggregate({
    where: {
      walletId: wallet.id,
      type: { in: ["TRANSFER", "WITHDRAWAL"] },
      status: { in: ["PENDING", "DETECTED"] },
    },
    _sum: { amount: true },
  });

  res.json({
    id: wallet.id,
    userId: wallet.userId,
    currency: wallet.currency,
    status: wallet.status,
    availableBalance: availableBalance.toFixed(2),
    pendingBalance: Number(pendingOut._sum.amount || 0).toFixed(2),
  });
});

router.get("/addresses", authenticate, async (req: AuthRequest, res: Response) => {
  const wallet = await prisma.wallet.findFirst({
    where: { userId: req.userId },
    include: { addresses: true },
  });
  res.json(wallet?.addresses || []);
});

router.get("/transactions", authenticate, async (req: AuthRequest, res: Response) => {
  const wallet = await prisma.wallet.findFirst({
    where: { userId: req.userId },
  });

  if (!wallet) return res.json([]);

  const transactions = await prisma.walletTransaction.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  type Tx = typeof transactions[0];
  const payoutOrderIds = transactions
    .filter((tx: Tx) => tx.type === "TRANSFER" && !!tx.payoutOrderId)
    .map((tx: Tx) => tx.payoutOrderId!);

  const payoutOrders = payoutOrderIds.length > 0
    ? await prisma.payoutOrder.findMany({
        where: { id: { in: payoutOrderIds } },
        select: { id: true, transferId: true },
      })
    : [];

  type Po = typeof payoutOrders[0];
  const transferIdByPayout = new Map(payoutOrders.map((po: Po) => [po.id, po.transferId]));

  res.json(transactions.map((tx: typeof transactions[0]) => ({
    ...tx,
    amount: Number(tx.amount),
    transferId: tx.payoutOrderId ? (transferIdByPayout.get(tx.payoutOrderId) || null) : null,
    transferType: tx.type === "TRANSFER" ? (tx.payoutOrderId ? "global" : "internal") : undefined,
  })));
});

router.get("/transactions/:id", authenticate, async (req: AuthRequest, res: Response) => {
  const wallet = await prisma.wallet.findFirst({
    where: { userId: req.userId },
  });

  if (!wallet) return res.status(404).json({ error: "Wallet not found" });

  const tx = await prisma.walletTransaction.findFirst({
    where: { id: req.params.id, walletId: wallet.id },
  });

  if (!tx) return res.status(404).json({ error: "Transaction not found" });

  let transferId: string | null = null;
  let recipientEmail: string | undefined;
  let recipientName: string | undefined;

  if (tx.payoutOrderId) {
    const po = await prisma.payoutOrder.findUnique({
      where: { id: tx.payoutOrderId },
      select: { transferId: true },
    });
    transferId = po?.transferId || null;
  } else if (tx.type === "TRANSFER" && tx.transactionNumber) {
    const creditEntry = await prisma.ledgerEntry.findFirst({
      where: { reference: tx.transactionNumber, type: "CREDIT" },
      include: { wallet: { include: { user: { select: { email: true, fullName: true } } } } },
    });
    if (creditEntry?.wallet?.user) {
      recipientEmail = creditEntry.wallet.user.email;
      recipientName = creditEntry.wallet.user.fullName || undefined;
    }
  }

  res.json({
    ...tx,
    amount: Number(tx.amount),
    transferId,
    transferType: tx.type === "TRANSFER" ? (tx.payoutOrderId ? "global" : "internal") : undefined,
    recipientEmail,
    recipientName,
  });
});

const internalTransferSchema = z.object({
  recipientEmail: z.string().email(),
  amount: z.union([z.string(), z.number()]).refine(
    (v) => !isNaN(Number(v)) && Number(v) > 0,
    "Amount must be a positive number"
  ),
});

router.post("/internal-transfer", authenticate, async (req: AuthRequest, res: Response) => {
  const { recipientEmail, amount } = internalTransferSchema.parse(req.body);
  const amountNum = Number(amount);

  if (req.userId === undefined) return res.status(401).json({ error: "Unauthorized" });

  const senderWallet = await prisma.wallet.findFirst({ where: { userId: req.userId } });
  if (!senderWallet) return res.status(400).json({ error: "Sender wallet not found" });

  const recipient = await prisma.user.findUnique({
    where: { email: recipientEmail },
    select: { id: true },
  });
  if (!recipient) return res.status(404).json({ error: "Recipient not found" });
  if (recipient.id === req.userId) return res.status(400).json({ error: "Cannot transfer to yourself" });

  const recipientWallet = await prisma.wallet.findFirst({ where: { userId: recipient.id } });
  if (!recipientWallet) return res.status(400).json({ error: "Recipient wallet not found" });

  const { totalFee: p2pFee } = await feeService.calculateP2pFee(amountNum);
  const totalDebit = amountNum + p2pFee;

  const txRef = generateTransactionNumber();

  const result = await lockService.withLock(`wallet:${senderWallet.id}`, async () => {
    const balance = await ledgerService.getBalance(senderWallet.id);
    if (balance < totalDebit) throw new Error("Insufficient balance");

    await (prisma as any).$transaction(async (tx: any) => {
      await tx.ledgerEntry.create({
        data: {
          walletId: senderWallet.id,
          type: "DEBIT",
          amount: totalDebit,
          reference: txRef,
          uniqueKey: `debit_${txRef}`,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          walletId: recipientWallet.id,
          type: "CREDIT",
          amount: amountNum,
          reference: txRef,
          uniqueKey: `credit_${txRef}`,
        },
      });

      await tx.systemObligation.upsert({
        where: { id: "singleton" },
        create: {
          id: "singleton",
          userLedgerObligation: 0,
          agentLedgerObligation: 0,
          pendingObligation: 0,
        },
        update: { userLedgerObligation: { decrement: p2pFee } },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: senderWallet.id,
          type: "TRANSFER",
          amount: amountNum,
          status: "COMPLETED",
          transactionNumber: txRef,
          metadata: { p2pFee },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: recipientWallet.id,
          type: "TRANSFER",
          amount: amountNum,
          status: "COMPLETED",
          transactionNumber: txRef,
        },
      });
    });

    return { success: true };
  });

  res.json(result);
});

const createDepositSchema = z.object({
  chain: z.enum(["BASE", "ETHEREUM", "POLYGON", "SOLANA"]),
  token: z.string().default(ENV.APP_CURRENCY_TOKEN),
});

router.post("/create-deposit", authenticate, async (req: AuthRequest, res: Response) => {
  const data = createDepositSchema.parse(req.body);
  const result = await depositService.createDepositRequest(req.userId!, data.chain, data.token);
  res.status(201).json(result);
});

export { router as walletRoutes };
