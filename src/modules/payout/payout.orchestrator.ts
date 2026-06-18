import { prisma } from "../../config/database";
import { partnerRouterService } from "../partners/router/partner-router.service";
import { getAdapter } from "../partners/adapters/index";
import { partnerRepository } from "../partners/registry/partner.repository";
import { slaMonitorService } from "../partners/sla/sla-monitor.service";
import { logger } from "../../utils/logger";

export class PayoutOrchestrator {
  async execute(transfer: { id: string; payoutMethod: string; amount: number; [key: string]: unknown }) {
    const order = await prisma.payoutOrder.create({
      data: {
        transferId: transfer.id,
        payoutMethod: transfer.payoutMethod,
        status: "PENDING",
        partner: "",
      },
    });

    try {
      const routing = await partnerRouterService.route({
        payoutMethod: transfer.payoutMethod,
        amount: transfer.amount,
      });

      const adapter = getAdapter(routing.adapterType);
      const start = Date.now();

      const response = await adapter.sendPayout({
        amount: transfer.amount,
        reference: transfer.id,
        beneficiaryName: transfer.beneficiaryName as string,
        bankName: transfer.bankName as string,
        accountNumber: transfer.accountNumber as string,
        phoneNumber: transfer.phoneNumber as string,
        provider: transfer.provider as string,
      });

      const elapsed = Date.now() - start;

      await slaMonitorService.recordSuccess(routing.partner.id, elapsed);
      await partnerRepository.createTransaction({
        transferId: transfer.id,
        partnerId: routing.partner.id,
        externalReference: response.externalReference,
        status: response.status,
        requestPayload: transfer as any,
        responsePayload: response as any,
      });

      await prisma.payoutOrder.update({
        where: { id: order.id },
        data: {
          partner: routing.partner.name,
          externalReference: response.externalReference,
          status: response.status === "SUCCESS" ? "SENT_TO_PARTNER" : response.status === "READY_FOR_PICKUP" ? "SENT_TO_PARTNER" : "PENDING",
        },
      });

      await prisma.payoutEvent.create({
        data: {
          payoutOrderId: order.id,
          eventType: "PAYOUT_SENT",
          payload: { partner: routing.partner.name, response },
        },
      });

      return { ...order, partner: routing.partner.name, externalReference: response.externalReference };
    } catch (error) {
      logger.error(`[PAYOUT] Payout failed for transfer ${transfer.id}`, error);

      await prisma.payoutOrder.update({
        where: { id: order.id },
        data: { status: "FAILED", partner: "ROUTING_FAILED" },
      });

      await prisma.payoutEvent.create({
        data: {
          payoutOrderId: order.id,
          eventType: "PAYOUT_FAILED",
          payload: { error: String(error) },
        },
      });

      return { ...order, status: "FAILED", partner: "ROUTING_FAILED" };
    }
  }
}
