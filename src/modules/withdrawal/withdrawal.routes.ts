import { z } from "zod";
import { Router, Response } from "express";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { withdrawalService } from "./withdrawal.service";
import { feeService } from "../fees/fee.service";
import { logger } from "../../utils/logger";

const router = Router();

const createWithdrawalSchema = z.object({
  network: z.enum(["BASE", "ETHEREUM", "POLYGON", "SOLANA"]),
  address: z.string().min(10),
  amount: z.number().positive(),
});

router.post("/", authenticate, async (req: AuthRequest, res: Response) => {
  const data = createWithdrawalSchema.parse(req.body);

  const wallet = await prisma.wallet.findFirst({
    where: { userId: req.userId },
  });

  if (!wallet) {
    return res.status(400).json({ error: "Wallet not found" });
  }

  const { totalFee } = await feeService.calculateWithdrawalFee(data.amount, data.network);
  const fee = totalFee;

  const withdrawal = await withdrawalService.createWithdrawal({
    userId: req.userId!,
    walletId: wallet.id,
    chain: data.network,
    destinationAddress: data.address,
    amount: data.amount,
    fee,
  });

  withdrawalService.executeWithdrawal(withdrawal.id).catch((err: Error) => {
    logger.error(`[Withdrawal] Background execution failed for ${withdrawal.id}:`, err);
  });

  res.status(201).json({
    id: withdrawal.id,
    amount: Number(withdrawal.amount),
    fee: Number(withdrawal.fee),
    netAmount: Number(withdrawal.netAmount),
    network: withdrawal.chain,
    status: withdrawal.status,
    txHash: withdrawal.txHash,
    explorerLink: withdrawal.explorerLink,
  });
});

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  const withdrawals = await prisma.withdrawal.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(withdrawals);
});

router.get("/:id", authenticate, async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const withdrawal = await prisma.withdrawal.findFirst({
    where: { id, userId: req.userId },
  });

  if (!withdrawal) {
    return res.status(404).json({ error: "Withdrawal not found" });
  }

  res.json(withdrawal);
});

export { router as withdrawalRoutes };
