import { prisma } from "../../config/database";
import { logger } from "../../utils/logger";

export class SweepService {
  async sweepExpiredDepositWallets() {
    const expiredWallets = await prisma.depositWallet.findMany({
      where: {
        status: "CREATED",
        expiresAt: { lte: new Date() },
      },
    });

    for (const wallet of expiredWallets) {
      await prisma.depositWallet.update({
        where: { id: wallet.id },
        data: { status: "EXPIRED" },
      });

      await prisma.depositRequest.updateMany({
        where: { 
          depositWalletId: wallet.id, 
          status: { in: ["PENDING", "WALLET_CREATED"] } 
        },
        data: { status: "FAILED" },
      });

      logger.info(`[Sweep] Expired deposit wallet ${wallet.id}`);
    }
  }
}

export const sweepService = new SweepService();
