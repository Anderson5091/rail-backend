import { prisma } from "../../config/database";
import { ledgerService } from "../ledger/ledger.service";
import { logger } from "../../utils/logger";

interface AgentWalletRow {
  id: string;
  walletType: string;
  network: string;
  chain: string;
  address: string;
  balance: { toString: () => string };
  status: string;
  lastSync: Date;
  createdAt: Date;
  updatedAt: Date;
  agentId: string;
  crossmintWalletId: string | null;
  walletLocator: string | null;
}

interface AgentTransactionRow {
  id: string;
  agentId: string;
  type: string;
  amount: { toString: () => string };
  commission: { toString: () => string };
  netAmount: { toString: () => string };
  userRef: string | null;
  status: string;
  reference: string | null;
  metadata: unknown;
  createdAt: Date;
}

interface AgentKpiRow {
  id: string;
  agentId: string;
  period: string;
  periodStart: Date;
  periodEnd: Date;
  totalVolume: { toString: () => string };
  totalCommission: { toString: () => string };
  totalTxCount: number;
  rewardPoints: { toString: () => string };
  rating: number | null;
  createdAt: Date;
}

export class AgentService {
  async addUserBalance(
    agentId: string,
    userId: string,
    fiatAmount: number,
    usdtAmount: number,
    commissionPercent: number
  ) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { wallets: true },
    });
    if (!agent) throw new Error("Agent not found");

    const commission = (usdtAmount * commissionPercent) / 100;
    const netUsdt = usdtAmount - commission;

    if (agent.type === "PARTNER") {
      const baseWallet = (agent.wallets as AgentWalletRow[]).find((w) => w.walletType === "BASE_TREASURY");
      if (!baseWallet) throw new Error("Agent base treasury wallet not found");
      if (Number(baseWallet.balance) < usdtAmount) {
        throw new Error("Insufficient agent treasury balance. Request top-up from internal agent.");
      }

      await prisma.agentWallet.update({
        where: { id: baseWallet.id },
        data: { balance: { decrement: usdtAmount } },
      });

      const commWallet = (agent.wallets as AgentWalletRow[]).find((w) => w.walletType === "COMMISSION");
      if (commWallet && commission > 0) {
        await prisma.agentWallet.update({
          where: { id: commWallet.id },
          data: { balance: { increment: commission } },
        });
      }
    } else {
      const hotWallet = await prisma.treasuryWallet.findFirst({
        where: { walletType: "HOT" },
      });
      if (!hotWallet) throw new Error("System hot treasury wallet not found");
      if (Number(hotWallet.balance) < usdtAmount) {
        throw new Error("Insufficient system treasury balance");
      }

      await prisma.treasuryWallet.update({
        where: { id: hotWallet.id },
        data: { balance: { decrement: usdtAmount } },
      });

      const commWallet = (agent.wallets as AgentWalletRow[]).find((w) => w.walletType === "COMMISSION");
      if (commWallet && commission > 0) {
        await prisma.agentWallet.update({
          where: { id: commWallet.id },
          data: { balance: { increment: commission } },
        });
      }
    }

    const userWallet = await prisma.wallet.findFirst({ where: { userId } });
    if (!userWallet) throw new Error("User wallet not found");

    await ledgerService.credit(userWallet.id, netUsdt, `agent_add_balance_${agentId}_${Date.now()}`);

    const tx = await prisma.agentTransaction.create({
      data: {
        agentId,
        type: "ADD_BALANCE",
        amount: usdtAmount,
        commission,
        netAmount: netUsdt,
        userRef: userId,
        status: "COMPLETED",
        reference: `ab_${agentId}_${Date.now()}`,
        metadata: { fiatAmount, commissionPercent },
      },
    });

    await this.recordKpi(agentId, usdtAmount, commission);

    logger.info(`[Agent] Agent ${agentId} added ${netUsdt} USDT to user ${userId} (commission: ${commission})`);
    return tx;
  }

  async executeWithdrawal(
    agentId: string,
    userId: string,
    amount: number,
    destinationAddress: string,
    commissionPercent: number
  ) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { wallets: true },
    });
    if (!agent) throw new Error("Agent not found");

    const commission = (amount * commissionPercent) / 100;
    const netAmount = amount - commission;

    const userWallet = await prisma.wallet.findFirst({ where: { userId } });
    if (!userWallet) throw new Error("User wallet not found");

    const balance = await ledgerService.getBalance(userWallet.id);
    if (balance < amount) throw new Error("Insufficient user balance");

    await ledgerService.debit(userWallet.id, amount, `agent_withdraw_${agentId}_${Date.now()}`);

    const commWallet = (agent.wallets as AgentWalletRow[]).find((w) => w.walletType === "COMMISSION");
    if (commWallet && commission > 0) {
      await prisma.agentWallet.update({
        where: { id: commWallet.id },
        data: { balance: { increment: commission } },
      });
    }

    const tx = await prisma.agentTransaction.create({
      data: {
        agentId,
        type: "WITHDRAW",
        amount,
        commission,
        netAmount,
        userRef: userId,
        status: "COMPLETED",
        reference: `wd_${agentId}_${Date.now()}`,
        metadata: { destinationAddress, fiatEquivalent: netAmount },
      },
    });

    await this.recordKpi(agentId, amount, commission);

    logger.info(`[Agent] Agent ${agentId} withdrew ${amount} USDT for user ${userId} (commission: ${commission})`);
    return tx;
  }

  async processGlobalPayment(
    agentId: string,
    userId: string,
    amount: number,
    paymentMethod: string,
    commissionPercent: number
  ) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { wallets: true },
    });
    if (!agent) throw new Error("Agent not found");

    const commission = (amount * commissionPercent) / 100;
    const netAmount = amount - commission;

    const userWallet = await prisma.wallet.findFirst({ where: { userId } });
    if (!userWallet) throw new Error("User wallet not found");

    const balance = await ledgerService.getBalance(userWallet.id);
    if (balance < amount) throw new Error("Insufficient user balance");

    await ledgerService.debit(userWallet.id, amount, `agent_payment_${agentId}_${Date.now()}`);

    const commWallet = (agent.wallets as AgentWalletRow[]).find((w) => w.walletType === "COMMISSION");
    if (commWallet) {
      await prisma.agentWallet.update({
        where: { id: commWallet.id },
        data: { balance: { increment: commission } },
      });
    }

    const tx = await prisma.agentTransaction.create({
      data: {
        agentId,
        type: "PAYMENT",
        amount,
        commission,
        netAmount,
        userRef: userId,
        status: "COMPLETED",
        reference: `pmt_${agentId}_${Date.now()}`,
        metadata: { paymentMethod },
      },
    });

    await this.recordKpi(agentId, amount, commission);

    logger.info(`[Agent] Agent ${agentId} processed payment for user ${userId} via ${paymentMethod}`);
    return tx;
  }

  async topUpPartnerBalance(
    internalAgentId: string,
    partnerAgentId: string,
    usdtAmount: number
  ) {
    const internalAgent = await prisma.agent.findUnique({
      where: { id: internalAgentId },
      include: { wallets: true },
    });
    if (!internalAgent || internalAgent.type !== "INTERNAL") {
      throw new Error("Only internal agents can top up partner balances");
    }

    const hotWallet = await prisma.treasuryWallet.findFirst({
      where: { walletType: "HOT" },
    });
    if (!hotWallet) throw new Error("System hot treasury not found");
    if (Number(hotWallet.balance) < usdtAmount) {
      throw new Error("Insufficient system treasury balance");
    }

    const partner = await prisma.agent.findUnique({
      where: { id: partnerAgentId },
      include: { wallets: true },
    });
    if (!partner || partner.type !== "PARTNER") {
      throw new Error("Target agent must be a partner");
    }

    const partnerWallet = (partner.wallets as AgentWalletRow[]).find((w) => w.walletType === "BASE_TREASURY");
    if (!partnerWallet) throw new Error("Partner base treasury wallet not found");

    await prisma.treasuryWallet.update({
      where: { id: hotWallet.id },
      data: { balance: { decrement: usdtAmount } },
    });

    await prisma.agentWallet.update({
      where: { id: partnerWallet.id },
      data: { balance: { increment: usdtAmount } },
    });

    const tx = await prisma.agentTransaction.create({
      data: {
        agentId: internalAgentId,
        type: "TOPUP",
        amount: usdtAmount,
        commission: 0,
        netAmount: usdtAmount,
        userRef: partnerAgentId,
        status: "COMPLETED",
        reference: `topup_${internalAgentId}_${Date.now()}`,
        metadata: { targetAgentId: partnerAgentId },
      },
    });

    logger.info(`[Agent] Internal agent ${internalAgentId} topped up partner ${partnerAgentId} with ${usdtAmount} USDT`);
    return tx;
  }

  async getAgentKpi(agentId: string, period?: string) {
    const where: { agentId: string; period?: string } = { agentId };
    if (period) where.period = period;

    const kpi = await prisma.agentKpi.findMany({
      where,
      orderBy: { periodStart: "desc" },
      take: 12,
    });

    return (kpi as AgentKpiRow[]).map((k: AgentKpiRow) => ({
      id: k.id,
      period: k.period,
      periodStart: k.periodStart,
      periodEnd: k.periodEnd,
      totalVolume: Number(k.totalVolume),
      totalCommission: Number(k.totalCommission),
      totalTxCount: k.totalTxCount,
      rewardPoints: Number(k.rewardPoints),
      rating: k.rating,
    }));
  }

  async getAgentDashboard(agentId: string) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        wallets: true,
        transactions: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!agent) throw new Error("Agent not found");

    const agentWallets = agent.wallets as AgentWalletRow[];
    const agentTransactions = agent.transactions as AgentTransactionRow[];

    const baseWallet = agentWallets.find((w) => w.walletType === "BASE_TREASURY");
    const commWallet = agentWallets.find((w) => w.walletType === "COMMISSION");

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTx = agentTransactions.filter((t) => new Date(t.createdAt) >= today);

    return {
      id: agent.id,
      email: agent.email,
      fullName: agent.fullName,
      type: agent.type,
      status: agent.status,
      kpiRating: agent.kpiRating,
      totalRewards: Number(agent.totalRewards),
      baseTreasuryBalance: baseWallet ? Number(baseWallet.balance) : null,
      commissionBalance: commWallet ? Number(commWallet.balance) : null,
      todayVolume: todayTx.reduce((sum: number, t: AgentTransactionRow) => sum + Number(t.amount), 0),
      todayCommission: todayTx.reduce((sum: number, t: AgentTransactionRow) => sum + Number(t.commission), 0),
      todayTxCount: todayTx.length,
      transactions: agentTransactions.map((t: AgentTransactionRow) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        commission: Number(t.commission),
        netAmount: Number(t.netAmount),
        userRef: t.userRef,
        status: t.status,
        createdAt: t.createdAt,
      })),
      wallets: agentWallets.map((w: AgentWalletRow) => ({
        id: w.id,
        walletType: w.walletType,
        network: w.network,
        address: w.address,
        balance: Number(w.balance),
      })),
    };
  }

  private async recordKpi(agentId: string, volume: number, commission: number) {
    const now = new Date();
    const periods = this.getKpiPeriods(now);

    for (const period of periods) {
      const existing = await prisma.agentKpi.findUnique({
        where: { agentId_period_periodStart: { agentId, period: period.key, periodStart: period.start } },
      });

      if (existing) {
        await prisma.agentKpi.update({
          where: { id: existing.id },
          data: {
            totalVolume: { increment: volume },
            totalCommission: { increment: commission },
            totalTxCount: { increment: 1 },
          },
        });
      } else {
        await prisma.agentKpi.create({
          data: {
            agentId,
            period: period.key,
            periodStart: period.start,
            periodEnd: period.end,
            totalVolume: volume,
            totalCommission: commission,
            totalTxCount: 1,
            rewardPoints: Math.floor(volume * 0.01 + commission * 0.1),
          },
        });
      }
    }
  }

  private getKpiPeriods(date: Date) {
    const y = date.getFullYear();
    const m = date.getMonth();
    const d = date.getDate();
    const dayOfWeek = date.getDay();

    const dailyStart = new Date(y, m, d, 0, 0, 0, 0);
    const dailyEnd = new Date(y, m, d, 23, 59, 59, 999);

    const weekStart = new Date(y, m, d - dayOfWeek, 0, 0, 0, 0);
    const weekEnd = new Date(y, m, d + (6 - dayOfWeek), 23, 59, 59, 999);

    const monthStart = new Date(y, m, 1, 0, 0, 0, 0);
    const monthEnd = new Date(y, m + 1, 0, 23, 59, 59, 999);

    return [
      { key: "DAILY", start: dailyStart, end: dailyEnd },
      { key: "WEEKLY", start: weekStart, end: weekEnd },
      { key: "MONTHLY", start: monthStart, end: monthEnd },
    ];
  }
}

export const agentService = new AgentService();
