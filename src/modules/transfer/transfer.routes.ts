import { z } from "zod";
import { Router, Response } from "express";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { idempotencyMiddleware } from "../../middleware/idempotency.middleware";
import { TransferOrchestrator } from "./transfer.orchestrator";

const router = Router();

const createSchema = z.object({
  beneficiaryId: z.string(),
  amount: z.number().positive(),
  payoutMethod: z.enum(["BANK", "MOBILE_MONEY", "CASH_PICKUP"]),
});

const orchestrator = new TransferOrchestrator();

router.post("/quote", async (req: AuthRequest, res: Response) => {
  const { amount, currency, country, method } = req.body;
  const fxService = await import("../fx/fx.service").then(m => m.fxService);
  const feeService = await import("../fees/fee.service").then(m => m.feeService);

  const fxRate = await fxService.getRate("USDT", currency);
  const { fee } = await feeService.calculate(country, method, amount);
  const destinationAmount = (amount - fee) * fxRate;

  res.json({ amount, fee, fxRate, destinationAmount });
});

router.post("/", authenticate, idempotencyMiddleware, async (req: AuthRequest, res: Response) => {
  const data = createSchema.parse(req.body);
  const transfer = await orchestrator.createTransfer(data, req.userId!);
  res.status(201).json(transfer);
});

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  const transfers = await prisma.transfer.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(transfers);
});

router.get("/:id", authenticate, async (req: AuthRequest, res: Response) => {
  const transfer = await prisma.transfer.findFirst({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!transfer) return res.status(404).json({ error: "Transfer not found" });
  res.json(transfer);
});

export { router as transferRoutes };
