import { z } from "zod";
import { Router, Response } from "express";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { PayoutOrchestrator } from "./payout.orchestrator";

const router = Router();
const orchestrator = new PayoutOrchestrator();

router.post("/execute", authenticate, async (req: AuthRequest, res: Response) => {
  const { transferId } = req.body;
  if (!transferId) return res.status(400).json({ error: "transferId required" });

  const transfer = await prisma.transfer.findFirst({
    where: { id: transferId, userId: req.userId },
  });
  if (!transfer) return res.status(404).json({ error: "Transfer not found" });

  const order = await orchestrator.execute(transfer);
  res.json(order);
});

router.get("/:id", authenticate, async (req: AuthRequest, res: Response) => {
  const order = await prisma.payoutOrder.findUnique({
    where: { id: req.params.id },
    include: { payoutEvents: { orderBy: { createdAt: "desc" } } },
  });
  if (!order) return res.status(404).json({ error: "Payout not found" });
  res.json(order);
});

router.post("/:id/retry", authenticate, async (req: AuthRequest, res: Response) => {
  const order = await prisma.payoutOrder.findUnique({
    where: { id: req.params.id },
  });
  if (!order) return res.status(404).json({ error: "Payout not found" });

  if (order.attemptCount >= 3) {
    return res.status(400).json({ error: "Max retries reached" });
  }

  await prisma.payoutOrder.update({
    where: { id: req.params.id },
    data: {
      status: "QUEUED",
      attemptCount: { increment: 1 },
    },
  });

  const transfer = await prisma.transfer.findUnique({
    where: { id: order.transferId },
  });
  if (!transfer) return res.status(404).json({ error: "Transfer not found" });

  const result = await orchestrator.execute(transfer);
  res.json(result);
});

export { router as payoutRoutes };
