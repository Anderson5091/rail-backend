import { prisma } from "../../config/database";
import { logger } from "../../utils/logger";

const DEPOSIT_EXPIRY_MS = 5 * 60 * 1000;

export class SweepService {
  async sweepExpiredDepositRequests() {
    const cutoff = new Date(Date.now() - DEPOSIT_EXPIRY_MS);

    const expired = await prisma.depositRequest.findMany({
      where: {
        status: { in: ["WALLET_CREATED", "PENDING", "AWAITING_DEPOSIT"] },
        createdAt: { lte: cutoff },
      },
    });

    for (const req of expired) {
      await prisma.depositRequest.update({
        where: { id: req.id },
        data: { status: "FAILED" },
      });

      logger.info(`[Sweep] Expired deposit request ${req.id} (status was ${req.status})`);
    }
  }
}

export const sweepService = new SweepService();
