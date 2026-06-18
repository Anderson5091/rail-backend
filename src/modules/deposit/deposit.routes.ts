import { z } from "zod";
import { Router, Response } from "express";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { depositService } from "./deposit.service";

const router = Router();

const createDepositSchema = z.object({
  chain: z.enum(["BASE", "ETHEREUM", "POLYGON", "SOLANA"]),
  token: z.string().default("USDT"),
});

router.post("/create", authenticate, async (req: AuthRequest, res: Response) => {
  const data = createDepositSchema.parse(req.body);
  const result = await depositService.createDepositRequest(req.userId!, data.chain, data.token);
  res.status(201).json(result);
});

router.get("/:id/address", authenticate, async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const address = await depositService.getDepositAddress(id);
  if (!address) {
    return res.status(404).json({ error: "Deposit request not found" });
  }
  res.json(address);
});

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  const deposits = await prisma.depositRequest.findMany({
    where: { userId: req.userId },
    include: { depositWallet: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(deposits);
});

const detectSchema = z.object({
  crossmintWalletId: z.string(),
  txHash: z.string(),
  amount: z.number().positive(),
  chain: z.string(),
});

router.post("/webhook/detect", async (req: AuthRequest, res: Response) => {
  const data = detectSchema.parse(req.body);
  await depositService.handleDepositDetected(data.crossmintWalletId, data.txHash, data.amount, data.chain);
  res.json({ ok: true });
});

export { router as depositRoutes };
