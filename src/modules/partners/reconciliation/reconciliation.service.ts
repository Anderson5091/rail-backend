import { prisma } from "../../../config/database";
import { logger } from "../../../utils/logger";

export class PartnerReconciliationService {
  async reconcile() {
    const payouts = await prisma.payoutOrder.findMany({
      where: { status: { in: ["DELIVERED", "CONFIRMED", "FAILED"] } },
      include: { partnerLogs: true },
    });

    let matched = 0;
    let unmatched = 0;
    let errors = 0;

    for (const payout of payouts) {
      const hasLog = payout.partnerLogs.length > 0;
      const hasEvent = await prisma.payoutEvent.findFirst({
        where: { payoutOrderId: payout.id, eventType: { contains: "CONFIRMED" } },
      });

      if (hasLog && hasEvent) {
        matched++;
      } else if (payout.status === "DELIVERED" && !hasEvent) {
        unmatched++;
        logger.warn(`[RECONCILIATION] Unmatched payout ${payout.id}: DELIVERED but no confirmation event`);
      } else {
        errors++;
      }
    }

    logger.info(`[RECONCILIATION] Complete: ${matched} matched, ${unmatched} unmatched, ${errors} errors`);

    return {
      total: payouts.length,
      matched,
      unmatched,
      errors,
    };
  }
}

export const partnerReconciliationService = new PartnerReconciliationService();
