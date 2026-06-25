import { prisma } from "../../config/database";
import { partnerRouterService } from "../partners/router/partner-router.service";
import { getAdapter } from "../partners/adapters/index";
import { partnerRepository } from "../partners/registry/partner.repository";
import { slaMonitorService } from "../partners/sla/sla-monitor.service";
import { ledgerService } from "../ledger/ledger.service";
import { logger } from "../../utils/logger";

export class PayoutOrchestrator {
  async execute(transfer: { id: string; payoutMethod: string; amount: number; beneficiaryId?: string; [key: string]: unknown }) {
    let order = await prisma.payoutOrder.findUnique({
      where: { transferId: transfer.id },
    });

    if (!order) {
      order = await prisma.payoutOrder.create({
        data: {
          transferId: transfer.id,
          payoutMethod: transfer.payoutMethod,
          status: "PENDING",
          partner: "",
        },
      });
    }

    const beneficiary = transfer.beneficiaryId
      ? await prisma.beneficiary.findUnique({ where: { id: transfer.beneficiaryId } })
      : null;

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
        beneficiaryName: beneficiary?.fullName,
        bankName: beneficiary?.bankName,
        accountNumber: beneficiary?.accountNumber,
        phoneNumber: beneficiary?.mobileWalletNumber,
        provider: beneficiary?.mobileProvider,
        location: beneficiary?.cashPickupLocation,
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
          status: response.status === "SUCCESS" || response.status === "READY_FOR_PICKUP" ? "SENT_TO_PARTNER" : "PENDING",
        },
      });

      await prisma.payoutEvent.create({
        data: {
          payoutOrderId: order.id,
          eventType: "PAYOUT_SENT",
          payload: { partner: routing.partner.name, response },
        },
      });

      if (response.status === "SUCCESS") {
        await prisma.walletTransaction.updateMany({
          where: { payoutOrderId: order.id },
          data: { status: "COMPLETED" },
        });

        await prisma.transfer.update({
          where: { id: transfer.id },
          data: { status: "COMPLETED" },
        });
      }

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

      // Auto-revert: credit funds back to the user's wallet (if registered)
      try {
        const transferRecord = await prisma.transfer.findUnique({ where: { id: transfer.id } });
        if (transferRecord && transferRecord.userId) {
          const wallet = await prisma.wallet.findFirst({ where: { userId: transferRecord.userId } });
          if (wallet) {
            await ledgerService.credit(wallet.id, Number(transferRecord.amount), `refund_payout_failed_${transfer.id}`);

            await prisma.walletTransaction.updateMany({
              where: { payoutOrderId: order.id, walletId: wallet.id },
              data: { status: "FAILED" },
            });
          }
        }
        if (transferRecord) {
          await prisma.transfer.update({
            where: { id: transfer.id },
            data: { status: "FAILED" },
          });
        }
      } catch (revertErr) {
        logger.error(`[PAYOUT] Failed to revert funds for transfer ${transfer.id}:`, revertErr);
      }

      return { ...order, status: "FAILED", partner: "ROUTING_FAILED" };
    }
  }
}
