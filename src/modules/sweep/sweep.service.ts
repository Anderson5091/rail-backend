import { prisma } from "../../config/database";
import { logger } from "../../utils/logger";

export class SweepService {
  async sweepExpiredDepositAddresses() {
    const expiredAddresses = await prisma.depositAddress.findMany({
      where: {
        status: "CREATED",
        expiresAt: { lte: new Date() },
      },
    });

    for (const addr of expiredAddresses) {
      await prisma.depositAddress.update({
        where: { id: addr.id },
        data: { status: "EXPIRED" },
      });

      await prisma.depositRequest.updateMany({
        where: { id: addr.depositRequestId, status: "PENDING" },
        data: { status: "EXPIRED" },
      });

      logger.info(`[Sweep] Expired deposit address ${addr.id}`);
    }
  }
}

export const sweepService = new SweepService();
