import crypto from "crypto";
import { partnerRepository } from "../registry/partner.repository";

export class PartnerWebhookService {
  verifySignature(payload: string, signature: string, secret: string): boolean {
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  async processWebhook(partnerId: string, eventType: string, payload: Record<string, unknown>) {
    await partnerRepository.createWebhook({ partnerId, eventType, payload });

    const txRef = payload.externalReference as string | undefined;
    if (txRef && payload.status) {
      const { prisma } = await import("../../../config/database");
      await prisma.payoutOrder.updateMany({
        where: { externalReference: txRef },
        data: { status: payload.status as string, updatedAt: new Date() },
      });

      const order = await prisma.payoutOrder.findFirst({ where: { externalReference: txRef } });
      if (order) {
        await prisma.payoutEvent.create({
          data: {
            payoutOrderId: order.id,
            eventType: `PARTNER_${eventType}`,
            payload,
          },
        });
      }
    }

    return { processed: true };
  }
}

export const partnerWebhookService = new PartnerWebhookService();
