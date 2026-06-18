import { Request, Response } from "express";
import { partnerWebhookService } from "./webhook.service";
import { partnerRepository } from "../registry/partner.repository";
import { logger } from "../../../utils/logger";

export class PartnerWebhookController {
  async receive(req: Request, res: Response) {
    const signature = req.headers["x-webhook-signature"] as string;
    const partnerId = req.params.partnerId as string;

    try {
      const partner = await partnerRepository.findById(partnerId);
      if (!partner) {
        return res.status(404).json({ error: "Partner not found" });
      }

      if (signature && partner.apiKey) {
        const payload = JSON.stringify(req.body);
        const isValid = partnerWebhookService.verifySignature(payload, signature, partner.apiKey);
        if (!isValid) {
          logger.warn(`[WEBHOOK] Invalid signature from partner ${partnerId}`);
          return res.status(401).json({ error: "Invalid signature" });
        }
      }

      const eventType = (req.body.event || req.body.eventType || "PAYOUT_UPDATE") as string;
      const result = await partnerWebhookService.processWebhook(partnerId, eventType, req.body);

      logger.info(`[WEBHOOK] Processed ${eventType} from partner ${partner.name}`);
      res.json(result);
    } catch (error) {
      logger.error(`[WEBHOOK] Error processing webhook from partner ${partnerId}`, error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  }
}

export const partnerWebhookController = new PartnerWebhookController();
