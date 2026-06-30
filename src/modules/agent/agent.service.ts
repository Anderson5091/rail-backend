import { prisma } from "../../config/database";
import { ledgerService } from "../ledger/ledger.service";
import { TransferOrchestrator } from "../transfer/transfer.orchestrator";
import { logger } from "../../utils/logger";
import { generateReferenceNumber } from "../../utils/id-generator";

const transferOrchestrator = new TransferOrchestrator();

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

    if (agent.type === "INTERNAL") {
      const hotWallet = await prisma.treasuryWallet.findFirst({ where: { walletType: "HOT" } });
      if (!hotWallet) throw new Error("System hot treasury not found");
      if (Number(hotWallet.balance) < usdtAmount) {
        throw new Error("Insufficient system treasury balance");
      }
      await prisma.treasuryWallet.update({
        where: { id: hotWallet.id },
        data: { balance: { decrement: usdtAmount } },
      });
      await prisma.treasuryMovement.create({
        data: {
          fromWallet: "HOT",
          toWallet: "AGENT_ADD_BALANCE",
          fromWalletId: hotWallet.id,
          amount: usdtAmount,
          network: hotWallet.network,
          reason: `Internal agent ${agentId} addBalance user`,
          status: "COMPLETED",
        },
      });
    } else {
      const wallet = (agent.wallets as AgentWalletRow[]).find((w) => w.walletType === "MAIN" || w.walletType === "BASE_TREASURY");
      if (!wallet) throw new Error("Agent wallet not found");
      if (Number(wallet.balance) < usdtAmount) {
        throw new Error("Insufficient agent wallet balance. Request top-up from internal agent.");
      }
      await prisma.agentWallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: usdtAmount } },
      });
    }

    if (commission > 0) {
      await prisma.agent.update({
        where: { id: agentId },
        data: { commissionLedger: { increment: commission } },
      });
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
        reference: generateReferenceNumber(),
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

    if (commission > 0) {
      await prisma.agent.update({
        where: { id: agentId },
        data: { commissionLedger: { increment: commission } },
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
        reference: generateReferenceNumber(),
        metadata: { destinationAddress, fiatEquivalent: netAmount },
      },
    });

    await this.recordKpi(agentId, amount, commission);

    logger.info(`[Agent] Agent ${agentId} withdrew ${amount} USDT for user ${userId} (commission: ${commission})`);
    return tx;
  }

  async processTransfer(
    agentId: string,
    payload: {
      userId?: string;
      amount: number;
      payoutMethod: string;
      beneficiaryId?: string;
      beneficiary?: {
        fullName: string;
        country: string;
        bankName?: string;
        accountNumber?: string;
        accountCurrency?: string;
        mobileWalletNumber?: string;
        mobileProvider?: string;
        cashPickupLocation?: string;
      };
      commissionPercent: number;
      currency?: string;
    }
  ) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { wallets: true },
    });
    if (!agent) throw new Error("Agent not found");

    const commission = (payload.amount * payload.commissionPercent) / 100;
    const netAmount = payload.amount - commission;

    if (agent.type === "INTERNAL") {
      const hotWallet = await prisma.treasuryWallet.findFirst({ where: { walletType: "HOT" } });
      if (!hotWallet) throw new Error("System hot treasury not found");
      if (Number(hotWallet.balance) < payload.amount) {
        throw new Error("Insufficient system treasury balance");
      }
      await prisma.treasuryWallet.update({
        where: { id: hotWallet.id },
        data: { balance: { decrement: payload.amount } },
      });
      await prisma.treasuryMovement.create({
        data: {
          fromWallet: "HOT",
          toWallet: "AGENT_TRANSFER",
          fromWalletId: hotWallet.id,
          amount: payload.amount,
          network: hotWallet.network,
          reason: `Internal agent ${agentId} transfer to beneficiary`,
          status: "COMPLETED",
        },
      });
    } else {
      const wallet = (agent.wallets as AgentWalletRow[]).find((w) => w.walletType === "MAIN" || w.walletType === "BASE_TREASURY");
      if (!wallet) throw new Error("Agent wallet not found");
      if (Number(wallet.balance) < payload.amount) {
        throw new Error("Insufficient agent wallet balance. Request top-up from internal agent.");
      }
      await prisma.agentWallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: payload.amount } },
      });
    }

    if (commission > 0) {
      await prisma.agent.update({
        where: { id: agentId },
        data: { commissionLedger: { increment: commission } },
      });
    }

    const transfer = await transferOrchestrator.createTransfer({
      userId: payload.userId || undefined,
      amount: netAmount,
      payoutMethod: payload.payoutMethod,
      beneficiaryId: payload.beneficiaryId,
      beneficiary: payload.beneficiary,
      currency: payload.currency,
      skipWalletDebit: true,
    });

    const agentTx = await prisma.agentTransaction.create({
      data: {
        agentId,
        type: "TRANSFER",
        amount: payload.amount,
        commission,
        netAmount,
        userRef: payload.userId || agentId,
        status: "COMPLETED",
        reference: transfer.referenceId,
        metadata: {
          payoutMethod: payload.payoutMethod,
          beneficiaryId: transfer.beneficiaryId,
          isRegistered: !!payload.userId,
          senderAgentId: agentId,
          senderAgentEmail: agent.email,
        },
      },
    });

    await this.recordKpi(agentId, payload.amount, commission);

    logger.info(`[Agent] Agent ${agentId} transferred ${netAmount} USDT to beneficiary ${transfer.beneficiaryId}`);
    return { agentTx, transfer };
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

    const partnerWallet = (partner.wallets as AgentWalletRow[]).find((w) => w.walletType === "MAIN" || w.walletType === "BASE_TREASURY");
    if (!partnerWallet) throw new Error("Partner wallet not found");

    await prisma.treasuryWallet.update({
      where: { id: hotWallet.id },
      data: { balance: { decrement: usdtAmount } },
    });

    await prisma.treasuryMovement.create({
      data: {
        fromWallet: "HOT",
        toWallet: "PARTNER_TOPUP",
        fromWalletId: hotWallet.id,
        amount: usdtAmount,
        network: hotWallet.network,
        reason: `Internal agent ${internalAgentId} topped up partner ${partnerAgentId}`,
        status: "COMPLETED",
      },
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
        reference: generateReferenceNumber(),
        metadata: { targetAgentId: partnerAgentId },
      },
    });

    logger.info(`[Agent] Internal agent ${internalAgentId} topped up partner ${partnerAgentId} with ${usdtAmount} USDT`);
    return tx;
  }

  async withdrawCommission(agentId: string) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { wallets: true },
    });
    if (!agent) throw new Error("Agent not found");

    const ledgerBalance = Number(agent.commissionLedger);
    if (ledgerBalance < 10) {
      throw new Error("Commission balance must be at least $10 to withdraw");
    }

    const wallet = (agent.wallets as AgentWalletRow[]).find((w) => w.walletType === "MAIN" || w.walletType === "BASE_TREASURY");
    if (!wallet) throw new Error("Agent wallet not found");

    await prisma.agent.update({
      where: { id: agentId },
      data: { commissionLedger: { decrement: ledgerBalance } },
    });

    await prisma.agentWallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: ledgerBalance } },
    });

    const tx = await prisma.agentTransaction.create({
      data: {
        agentId,
        type: "COMMISSION_WITHDRAW",
        amount: ledgerBalance,
        commission: 0,
        netAmount: ledgerBalance,
        status: "COMPLETED",
        reference: generateReferenceNumber(),
        metadata: { fromLedger: true, toWallet: wallet.id },
      },
    });

    logger.info(`[Agent] Agent ${agentId} withdrew ${ledgerBalance} USDT from commission to base wallet`);
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

    const wallet = agentWallets.find((w) => w.walletType === "MAIN" || w.walletType === "BASE_TREASURY" || w.walletType === "BASE_TREASURY");

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTx = agentTransactions.filter((t) => new Date(t.createdAt) >= today);

    const pendingTransfers = await prisma.transfer.findMany({
      where: {
        status: { in: ["PENDING_PAYOUT", "PROCESSING"] },
        OR: [
          { processingAgentId: null },
          { processingAgentId: agentId }
        ]
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return {
      id: agent.id,
      email: agent.email,
      fullName: agent.fullName,
      type: agent.type,
      status: agent.status,
      kpiRating: agent.kpiRating,
      totalRewards: Number(agent.totalRewards),
      commissionLedgerBalance: Number(agent.commissionLedger),
      walletBalance: wallet ? Number(wallet.balance) : null,
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
      wallets: agentWallets
        .filter((w: AgentWalletRow) => w.walletType !== "COMMISSION")
        .map((w: AgentWalletRow) => ({
          id: w.id,
          walletType: w.walletType === "BASE_TREASURY" ? "MAIN" : w.walletType,
          network: w.network,
          balance: Number(w.balance),
        })),
      pendingTransfers: pendingTransfers.map((t: any) => ({
        id: t.id,
        beneficiaryId: t.beneficiaryId,
        amount: Number(t.amount),
        payoutMethod: t.payoutMethod,
        currency: t.currency,
        status: t.status,
        referenceId: t.referenceId,
        processingAgentId: t.processingAgentId,
        createdAt: t.createdAt,
      })),
    };
  }

  async upgradeAgentWallet(agentId: string) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { wallets: true },
    });
    if (!agent) throw new Error("Agent not found");

    const agentWallets = agent.wallets as AgentWalletRow[];
    const results: string[] = [];
    const walletType = "MAIN";
    const existing = agentWallets.find((w) => w.walletType === walletType);

    if (!existing) {
      try {
        const alias = `agent_wallet_${agent.id}`;
        const { crossmintService } = await import("../../services/crossmint.service");
        const cw = await crossmintService.createWallet("base", "AGENT", agent.id, alias);
        await prisma.agentWallet.create({
          data: {
            agentId,
            walletType,
            network: "BASE",
            chain: "base",
            address: cw.address,
            crossmintWalletId: cw.crossmintWalletId,
            walletLocator: cw.walletLocator,
            balance: 0,
          },
        });
        results.push(`${walletType}: created (${cw.address})`);
      } catch {
        await prisma.agentWallet.create({
          data: {
            agentId,
            walletType,
            network: "BASE",
            chain: "base",
            address: `wallet_${agent.id}`,
            balance: 0,
          },
        });
        results.push(`${walletType}: created (dummy)`);
      }
    } else if (existing.address.startsWith("MAIN_") || existing.address.startsWith("BASE_TREASURY_") || existing.address.startsWith("wallet_")) {
      try {
        const alias = `agent_wallet_${agent.id}`;
        const { crossmintService } = await import("../../services/crossmint.service");
        const cw = await crossmintService.createWallet("base", "AGENT", agent.id, alias);
        await prisma.agentWallet.update({
          where: { id: existing.id },
          data: {
            address: cw.address,
            crossmintWalletId: cw.crossmintWalletId,
            walletLocator: cw.walletLocator,
          },
        });
        results.push(`${walletType}: upgraded (${cw.address})`);
      } catch {
        results.push(`${walletType}: upgrade failed, keeping existing`);
      }
    } else {
      results.push(`${walletType}: already real`);
    }

    return { upgraded: true, results };
  }

  async recordKpi(agentId: string, volume: number, commission: number) {
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

  async lookupUser(identifier: string) {
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { id: identifier },
          { email: identifier },
          { phone: identifier },
        ],
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
      },
    });
    return user;
  }
}

export const agentService = new AgentService();
