import { prisma } from "../../config/database";

export interface SolvencyReport {
  healthy: boolean;
  availableLiquidity: number;
  userObligation: number;
  agentObligation: number;
  pendingObligation: number;
  totalObligation: number;
  hotBalance: number;
  warmBalance: number;
  coldBalance: number;
  hotWarmTotal: number;
  deficit: number | null;
}

export class LiquidityEnforcerService {
  async getOperationalBalance(): Promise<number> {
    const wallets = await prisma.treasuryWallet.findMany({
      where: { walletType: { in: ["HOT", "WARM"] } },
    });
    return wallets.reduce((sum: number, w: { balance: { toString: () => string } }) => sum + Number(w.balance), 0);
  }

  async getTotalTreasuryBalance(): Promise<number> {
    const wallets = await prisma.treasuryWallet.findMany();
    return wallets.reduce((sum: number, w: { balance: { toString: () => string } }) => sum + Number(w.balance), 0);
  }

  async getUserObligation(): Promise<number> {
    const row = await prisma.systemObligation.findUnique({
      where: { id: "singleton" },
    });
    return row ? Number(row.userLedgerObligation) : 0;
  }

  async getAgentObligation(): Promise<number> {
    const row = await prisma.systemObligation.findUnique({
      where: { id: "singleton" },
    });
    return row ? Number(row.agentLedgerObligation) : 0;
  }

  async getPendingObligation(): Promise<number> {
    const row = await prisma.systemObligation.findUnique({
      where: { id: "singleton" },
    });
    return row ? Number(row.pendingObligation) : 0;
  }

  async getTotalObligation(): Promise<number> {
    const row = await prisma.systemObligation.findUnique({
      where: { id: "singleton" },
    });
    if (!row) return 0;
    return Number(row.userLedgerObligation) + Number(row.agentLedgerObligation) + Number(row.pendingObligation);
  }

  async getAvailableLiquidity(): Promise<number> {
    const operational = await this.getOperationalBalance();
    const totalObligation = await this.getTotalObligation();
    return operational - totalObligation;
  }

  async ensureLiquidity(amount: number): Promise<void> {
    const available = await this.getAvailableLiquidity();
    if (available < amount) {
      throw new Error("Insufficient platform liquidity. Contact treasury for more funds.");
    }
  }

  async updateObligation(deltaUser: number, deltaAgent: number, deltaPending: number): Promise<void> {
    await prisma.systemObligation.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        userLedgerObligation: deltaUser,
        agentLedgerObligation: deltaAgent,
        pendingObligation: deltaPending,
      },
      update: {
        userLedgerObligation: { increment: deltaUser },
        agentLedgerObligation: { increment: deltaAgent },
        pendingObligation: { increment: deltaPending },
      },
    });
  }

  async recalibrate(): Promise<void> {
    const [userCredits, userDebits, agentCredits, agentDebits, pendingTransfers] = await Promise.all([
      prisma.ledgerEntry.aggregate({ where: { type: "CREDIT" }, _sum: { amount: true } }),
      prisma.ledgerEntry.aggregate({ where: { type: "DEBIT" }, _sum: { amount: true } }),
      prisma.agentLedgerEntry.aggregate({ where: { type: "CREDIT" }, _sum: { amount: true } }),
      prisma.agentLedgerEntry.aggregate({ where: { type: "DEBIT" }, _sum: { amount: true } }),
      prisma.transfer.aggregate({
        where: { status: { in: ["PENDING_PAYOUT", "SENT_TO_PARTNER"] } },
        _sum: { amount: true },
      }),
    ]);

    const userObligation = Number(userCredits._sum.amount || 0) - Number(userDebits._sum.amount || 0);
    const agentObligation = Number(agentCredits._sum.amount || 0) - Number(agentDebits._sum.amount || 0);
    const pendingObligation = Number(pendingTransfers._sum.amount || 0);

    await prisma.systemObligation.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        userLedgerObligation: userObligation,
        agentLedgerObligation: agentObligation,
        pendingObligation,
      },
      update: {
        userLedgerObligation: userObligation,
        agentLedgerObligation: agentObligation,
        pendingObligation,
      },
    });
  }

  async getSolvencyReport(): Promise<SolvencyReport> {
    const [userObligation, agentObligation, pendingObligation, hotWarmTotal, coldBalance] = await Promise.all([
      this.getUserObligation(),
      this.getAgentObligation(),
      this.getPendingObligation(),
      this.getOperationalBalance(),
      (async () => {
        const coldWallets = await prisma.treasuryWallet.findMany({
          where: { walletType: "COLD" },
        });
        return coldWallets.reduce((sum: number, w: { balance: { toString: () => string } }) => sum + Number(w.balance), 0);
      })(),
    ]);

    const totalObligation = userObligation + agentObligation + pendingObligation;
    const availableLiquidity = hotWarmTotal - totalObligation;
    const healthy = availableLiquidity >= 0;

    const hotBalance = (await prisma.treasuryWallet.findMany({ where: { walletType: "HOT" } }))
      .reduce((sum: number, w: { balance: { toString: () => string } }) => sum + Number(w.balance), 0);

    const warmBalance = (await prisma.treasuryWallet.findMany({ where: { walletType: "WARM" } }))
      .reduce((sum: number, w: { balance: { toString: () => string } }) => sum + Number(w.balance), 0);

    return {
      healthy,
      availableLiquidity,
      userObligation,
      agentObligation,
      pendingObligation,
      totalObligation,
      hotBalance,
      warmBalance,
      coldBalance,
      hotWarmTotal,
      deficit: healthy ? null : Math.abs(availableLiquidity),
    };
  }
}

export const liquidityEnforcer = new LiquidityEnforcerService();
