import { prisma } from "../../config/database";

export class LiquidityService {
  async snapshot() {
    const wallets = await prisma.treasuryWallet.findMany();
    const networks = ["BASE", "ETHEREUM", "SOLANA", "POLYGON"];

    for (const network of networks) {
      const hot = wallets.find((w: { walletType: string; network: string }) => w.walletType === "HOT" && w.network === network);
      const warm = wallets.find((w: { walletType: string; network: string }) => w.walletType === "WARM" && w.network === network);
      const cold = wallets.find((w: { walletType: string; network: string }) => w.walletType === "COLD" && w.network === network);

      const hotBal = hot ? Number(hot.balance) : 0;
      const warmBal = warm ? Number(warm.balance) : 0;
      const coldBal = cold ? Number(cold.balance) : 0;

      await prisma.liquiditySnapshot.create({
        data: {
          network,
          hotBalance: hotBal,
          warmBalance: warmBal,
          coldBalance: coldBal,
          totalBalance: hotBal + warmBal + coldBal,
        },
      });
    }
  }
}

export const liquidityService = new LiquidityService();
