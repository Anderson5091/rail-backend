import { z } from "zod";
import { Router, Request, Response } from "express";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { depositService } from "./deposit.service";
import { relayService } from "../../services/relay.service";
import { ENV } from "../../config/env";
import { logger } from "../../utils/logger";

const router = Router();

const createDepositSchema = z.object({
  chain: z.enum(["BASE", "ETHEREUM", "POLYGON", "SOLANA", "TRON"]),
  token: z.string().default("USDT"),
});

router.post("/create", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const data = createDepositSchema.parse(req.body);
    const result = await depositService.createDepositRequest(req.userId!, data.chain, data.token);
    res.status(201).json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues });
    }
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.get("/:id/status", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const status = await depositService.getDepositStatus(id);
    if (!status) {
      return res.status(404).json({ error: "Deposit request not found" });
    }
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const deposits = await prisma.depositRequest.findMany({
      where: { userId: req.userId },
      include: { depositWallet: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(deposits);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

const detectSchema = z.object({
  crossmintWalletId: z.string(),
  txHash: z.string(),
  amount: z.number().positive(),
  chain: z.string(),
});

router.post("/webhook/detect", async (req: Request, res: Response) => {
  try {
    const data = detectSchema.parse(req.body);
    await depositService.handleDepositDetected(data.crossmintWalletId, data.txHash, data.amount, data.chain);
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues });
    }
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

const confirmSchema = z.object({
  depositRequestId: z.string(),
});

router.post("/webhook/confirm", async (req: Request, res: Response) => {
  try {
    const data = confirmSchema.parse(req.body);
    const result = await depositService.confirmDeposit(data.depositRequestId);
    res.json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues });
    }
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

const relayWebhookSchema = z.object({
  requestId: z.string(),
  status: z.string(),
  depositAddress: z.string().optional(),
  txHashes: z.array(z.string()).optional(),
});

router.post("/webhook/relay", async (req: Request, res: Response) => {
  try {
    const data = relayWebhookSchema.parse(req.body);
    logger.info(`[Relay] Webhook received: requestId=${data.requestId}, status=${data.status}`);

    const depositRequest = await prisma.depositRequest.findFirst({
      where: { relayRequestId: data.requestId },
    });

    if (!depositRequest) {
      return res.status(404).json({ error: "No matching deposit request found" });
    }

    if (data.status === "COMPLETED" || data.status === "SETTLED") {
      const statusData = await relayService.getRequestStatus(data.requestId);
      const inTx = statusData.inTxHashes?.[0];
      const txHash = data.txHashes?.[0] || inTx || "relay_unknown";

      let amount: number | undefined;
      if (depositRequest.depositAddress) {
        const requestsData = await relayService.getRequestsByDepositAddress(depositRequest.depositAddress);
        const matched = requestsData.requests?.find((r) => r.id === data.requestId || r.status === "COMPLETED");
        if (matched?.data?.currencyIn?.amount) {
          amount = parseFloat(matched.data.currencyIn.amount);
        }
      }

      await prisma.depositRequest.update({
        where: { id: depositRequest.id },
        data: {
          txHash,
          status: "CONFIRMED",
          confirmations: 5,
          ...(amount != null ? { amount } : {}),
        },
      });

      if (amount != null) {
        await depositService.approveDeposit(depositRequest.id);
      }
      await depositService.creditUserBalance(depositRequest.id);

      logger.info(`[Relay] Deposit ${depositRequest.id} confirmed and credited via Relay webhook${amount != null ? ` amount=${amount}` : ""}`);
    }

    if (data.status === "FAILED") {
      await prisma.depositRequest.update({
        where: { id: depositRequest.id },
        data: { status: "FAILED" },
      });
      logger.warn(`[Relay] Deposit ${depositRequest.id} failed`);
    }

    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues });
    }
    logger.error("[Relay] Webhook error:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

export { router as depositRoutes };
