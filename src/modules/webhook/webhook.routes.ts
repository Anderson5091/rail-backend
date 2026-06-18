import { Router, Request, Response } from "express";
import { prisma } from "../../config/database";
import { partnerRepository } from "../partners/registry/partner.repository";
import { partnerWebhookService } from "../partners/webhook/webhook.service";
import { crossmintWebhookService } from "./crossmint-webhook.service";
import { logger } from "../../utils/logger";

const router = Router();

router.post("/payout-update", async (req: Request, res: Response) => {
  const { payoutOrderId, status, externalReference, partnerId } = req.body;

  if (!payoutOrderId) {
    return res.status(400).json({ error: "payoutOrderId required" });
  }

  await prisma.payoutOrder.update({
    where: { id: payoutOrderId },
    data: {
      status,
      externalReference,
      updatedAt: new Date(),
    },
  });

  await prisma.payoutEvent.create({
    data: {
      payoutOrderId,
      eventType: `PAYOUT_${status}`,
      payload: req.body,
    },
  });

  if (partnerId) {
    await partnerWebhookService.processWebhook(partnerId, `PAYOUT_${status}`, req.body);
    await partnerRepository.createTransaction({
      transferId: payoutOrderId,
      partnerId,
      externalReference: externalReference || "",
      status,
      requestPayload: {} as any,
      responsePayload: req.body,
    });
  }

  logger.info(`[WEBHOOK] Payout ${payoutOrderId} updated to ${status}`);
  res.json({ ok: true });
});

router.post("/crossmint", async (req: Request, res: Response) => {
  await crossmintWebhookService.handleWebhook(req, res);
});

export { router as webhookRoutes };
