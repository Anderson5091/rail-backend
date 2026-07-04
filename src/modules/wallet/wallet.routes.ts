import { z } from "zod";
import { Router, Response } from "express";
import { prisma } from "../../config/database";
import { ENV } from "../../config/env";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { crossmintService, type ChainType } from "../../services/crossmint.service";
import { depositService } from "../deposit/deposit.service";
import { ledgerService } from "../ledger/ledger.service";
import { lockService } from "../../services/lock.service";
import { logger } from "../../utils/logger";

const router = Router();

async function ensureUserDepositWallets(userId: string) {
  const evmChain = ENV.NETWORK_CHAIN[ENV.SUPPORTED_NETWORKS.indexOf("BASE")] as ChainType;
  const solanaChain = ENV.NETWORK_CHAIN[ENV.SUPPORTED_NETWORKS.indexOf("SOLANA")] as ChainType;

  const walletConfigs = [
    { alias: "evm", chain: evmChain || ("base-sepolia" as ChainType) },
    { alias: "solana", chain: solanaChain || ("solana" as ChainType) },
  ];

  for (const cfg of walletConfigs) {
    const existing = await prisma.depositWallet.findUnique({
      where: { userId_alias: { userId, alias: cfg.alias } },
    });

    if (existing) continue;

    try {
      const wallet = await crossmintService.createWallet(cfg.chain, "DEPOSIT", userId, cfg.alias);

      await prisma.depositWallet.create({
        data: {
          userId,
          alias: cfg.alias,
          crossmintWalletId: wallet.crossmintWalletId,
          walletLocator: wallet.walletLocator,
          address: wallet.address,
          chain: cfg.chain,
        },
      });

      logger.info(`[Wallet] Created ${cfg.alias} wallet for user ${userId}: ${wallet.address}`);
    } catch (error) {
      logger.error(`[Wallet] Failed to create ${cfg.alias} wallet for user ${userId}:`, error);
    }
  }
}

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  let wallet = await prisma.wallet.findFirst({
    where: { userId: req.userId },
  });

  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: { userId: req.userId! },
    });
  }

  await ensureUserDepositWallets(req.userId!);

  const depositWallets = await prisma.depositWallet.findMany({
    where: { userId: req.userId },
  });

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
    cryptoWallets: depositWallets.map((w: { alias: string; chain: string; address: string }) => ({
      network: w.alias.toUpperCase(),
      chain: w.chain,
      address: w.address,
    })),
  });
});

router.get("/crypto-wallets", authenticate, async (req: AuthRequest, res: Response) => {
  await ensureUserDepositWallets(req.userId!);

  const wallets = await prisma.depositWallet.findMany({
    where: { userId: req.userId },
  });

  res.json(wallets);
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
  })));
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

  const result = await lockService.withLock(`wallet:${senderWallet.id}`, async () => {
    const balance = await ledgerService.getBalance(senderWallet.id);
    if (balance < amountNum) throw new Error("Insufficient balance");

    await ledgerService.debit(senderWallet.id, amountNum, `internal_to_${recipient.id}`);
    await ledgerService.credit(recipientWallet.id, amountNum, `internal_from_${req.userId}`);

    await prisma.walletTransaction.createMany({
      data: [
        {
          walletId: senderWallet.id,
          type: "TRANSFER",
          amount: amountNum,
          status: "COMPLETED",
        },
        {
          walletId: recipientWallet.id,
          type: "TRANSFER",
          amount: amountNum,
          status: "COMPLETED",
        },
      ],
    });

    return { success: true };
  });

  res.json(result);
});

const createDepositSchema = z.object({
  chain: z.enum(["BASE", "ETHEREUM", "POLYGON", "SOLANA"]),
  token: z.string().default("USDT"),
});

router.post("/create-deposit", authenticate, async (req: AuthRequest, res: Response) => {
  const data = createDepositSchema.parse(req.body);
  const result = await depositService.createDepositRequest(req.userId!, data.chain, data.token);
  res.status(201).json(result);
});

export { router as walletRoutes };
