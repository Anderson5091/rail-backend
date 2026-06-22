import { randomBytes } from "crypto";
import { z } from "zod";
import { Router, Response } from "express";
import { prisma } from "../../config/database";
import { ENV } from "../../config/env";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { crossmintService, type ChainType } from "../../services/crossmint.service";
import { depositService } from "../deposit/deposit.service";
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
      const wallet = await crossmintService.createWallet(cfg.chain, "DEPOSIT");

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

  const balance = await prisma.ledgerEntry.aggregate({
    where: { walletId: wallet.id },
    _sum: { amount: true },
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

  res.json({
    id: wallet.id,
    userId: wallet.userId,
    currency: wallet.currency,
    status: wallet.status,
    availableBalance: availableBalance.toFixed(2),
    pendingBalance: "0.00",
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

  res.json(transactions);
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

const internalTransferSchema = z.object({
  recipientEmail: z.string().email(),
  amount: z.number().positive(),
});

router.post("/internal-transfer", authenticate, async (req: AuthRequest, res: Response) => {
  const data = internalTransferSchema.parse(req.body);

  const recipient = await prisma.user.findUnique({ where: { email: data.recipientEmail } });
  if (!recipient) {
    logger.warn(`[P2P] Recipient not found: ${data.recipientEmail}`);
    throw new AppError(404, "Recipient not found");
  }
  if (recipient.id === req.userId) throw new AppError(400, "Cannot transfer to yourself");

  const senderWallet = await prisma.wallet.findFirst({ where: { userId: req.userId } });
  if (!senderWallet) throw new AppError(404, "Sender wallet not found");

  let finalRecipientWallet = await prisma.wallet.findFirst({ where: { userId: recipient.id } });
  if (!finalRecipientWallet) {
    finalRecipientWallet = await prisma.wallet.create({ data: { userId: recipient.id } });
  }

  const referenceId = `P2P-${randomBytes(8).toString("hex")}`;

  const result = await lockService.withLock(`wallet:${senderWallet.id}`, async () => {
    return await (prisma as any).$transaction(async (tx: any) => {
      const credits = await tx.ledgerEntry.aggregate({
        where: { walletId: senderWallet.id, type: "CREDIT" },
        _sum: { amount: true },
      });

      const debits = await tx.ledgerEntry.aggregate({
        where: { walletId: senderWallet.id, type: "DEBIT" },
        _sum: { amount: true },
      });

      const balance = Number(credits._sum.amount || 0) - Number(debits._sum.amount || 0);
      logger.info(`[P2P] Balance: credits=${credits._sum.amount} debits=${debits._sum.amount} balance=${balance} amount=${data.amount}`);
      if (balance < data.amount) throw new AppError(400, `Insufficient balance (${balance.toFixed(2)} USDT available, ${data.amount} USDT needed)`);

      await tx.ledgerEntry.create({
        data: {
          walletId: senderWallet.id,
          type: "DEBIT",
          amount: data.amount,
          reference: referenceId,
          uniqueKey: `debit_${referenceId}`,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          walletId: finalRecipientWallet.id,
          type: "CREDIT",
          amount: data.amount,
          reference: referenceId,
          uniqueKey: `credit_${referenceId}`,
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: senderWallet.id,
          type: "TRANSFER",
          amount: data.amount,
          status: "COMPLETED",
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: finalRecipientWallet.id,
          type: "TRANSFER",
          amount: data.amount,
          status: "COMPLETED",
        },
      });

      return { message: "Transfer completed", referenceId };
    });
  });

  logger.info(`[P2P] ${req.userId} sent ${data.amount} USDT to ${data.recipientEmail} (recipient ${recipient.id})`);
  res.json(result);
});

export { router as walletRoutes };
