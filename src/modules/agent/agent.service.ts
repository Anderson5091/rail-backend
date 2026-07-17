import { prisma } from "../../config/database";
import { ledgerService } from "../ledger/ledger.service";
import { agentLedgerService } from "./agent-ledger.service";
import { TransferOrchestrator } from "../transfer/transfer.orchestrator";
import { feeService } from "../fees/fee.service";
import { ENV } from "../../config/env";
import { logger } from "../../utils/logger";
import { generateReferenceNumber } from "../../utils/id-generator";
import { crossmintService, type ChainType } from "../../services/crossmint.service";

const transferOrchestrator = new TransferOrchestrator();

interface AgentWalletRow {
  id: string;
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
      if (Number(hotWallet.balance) < netUsdt) {
        throw new Error("Insufficient system treasury balance");
      }
      await prisma.treasuryWallet.update({
        where: { id: hotWallet.id },
        data: { balance: { decrement: netUsdt } },
      });
      await prisma.treasuryMovement.create({
        data: {
          fromWallet: "HOT",
          toWallet: "AGENT_ADD_BALANCE",
          fromWalletId: hotWallet.id,
          amount: netUsdt,
          network: hotWallet.network,
          reason: `Internal agent ${agentId} addBalance user`,
          status: "COMPLETED",
        },
      });
    } else {
      await agentLedgerService.ensureBalance(agentId, netUsdt);
      await agentLedgerService.debit(agentId, netUsdt, "ADD_BALANCE", `add_balance_${agentId}_${Date.now()}`, `Credit user ${userId}`);
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

    logger.info(`[Agent] Agent ${agentId} added ${netUsdt} ${ENV.APP_CURRENCY_TOKEN} to user ${userId} (commission: ${commission})`);
    return tx;
  }

  async executeWithdrawal(
    agentId: string,
    userId: string,
    amount: number,
    commissionPercent: number,
    destinationType?: "OFFCHAIN" | "MAIN"
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

    await agentLedgerService.credit(agentId, amount, "WITHDRAW", `withdraw_${agentId}_${Date.now()}`, `From user ${userId}`);

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
        metadata: { fiatEquivalent: netAmount, destinationType: destinationType || "OFFCHAIN" },
      },
    });

    await this.recordKpi(agentId, amount, commission);

    logger.info(`[Agent] Agent ${agentId} withdrew ${amount} ${ENV.APP_CURRENCY_TOKEN} for user ${userId} (commission: ${commission})`);
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
      debitUserWallet?: boolean;
    }
  ) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { wallets: true },
    });
    if (!agent) throw new Error("Agent not found");

    const commission = (payload.amount * payload.commissionPercent) / 100;
    const netAmount = payload.amount - commission;

    const shouldDebitAgent = !payload.debitUserWallet || !payload.userId;

    if (shouldDebitAgent) {
      if (agent.type === "INTERNAL") {
        const hotWallet = await prisma.treasuryWallet.findFirst({ where: { walletType: "HOT" } });
        if (!hotWallet) throw new Error("System hot treasury not found");
        if (Number(hotWallet.balance) < netAmount) {
          throw new Error("Insufficient system treasury balance");
        }
        await prisma.treasuryWallet.update({
          where: { id: hotWallet.id },
          data: { balance: { decrement: netAmount } },
        });
        await prisma.treasuryMovement.create({
          data: {
            fromWallet: "HOT",
            toWallet: "AGENT_TRANSFER",
            fromWalletId: hotWallet.id,
            amount: netAmount,
            network: hotWallet.network,
            reason: `Internal agent ${agentId} transfer to beneficiary`,
            status: "COMPLETED",
          },
        });
      } else {
        await agentLedgerService.ensureBalance(agentId, netAmount);
        await agentLedgerService.debit(agentId, netAmount, "TRANSFER", `transfer_${agentId}_${Date.now()}`, `Payout method: ${payload.payoutMethod}`);
      }
    }

    const transfer = await transferOrchestrator.createTransfer({
      userId: payload.userId || undefined,
      amount: netAmount,
      payoutMethod: payload.payoutMethod,
      beneficiaryId: payload.beneficiaryId,
      beneficiary: payload.beneficiary,
      currency: payload.currency,
      skipWalletDebit: shouldDebitAgent,
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
          debitUserWallet: !shouldDebitAgent,
        },
      },
    });

    await this.recordKpi(agentId, payload.amount, commission);

    logger.info(`[Agent] Agent ${agentId} transferred ${netAmount} ${ENV.APP_CURRENCY_TOKEN} to beneficiary ${transfer.beneficiaryId} (debitUserWallet: ${!shouldDebitAgent})`);
    return { agentTx, transfer };
  }

  async topUpPartnerBalance(
    callerId: string,
    partnerAgentId: string,
    usdtAmount: number,
    callerRole?: string
  ) {
    const isAdmin = callerRole === "SUPER_ADMIN" || callerRole === "OPS";

    if (!isAdmin) {
      const internalAgent = await prisma.agent.findUnique({
        where: { id: callerId },
        include: { wallets: true },
      });
      if (!internalAgent || internalAgent.type !== "INTERNAL") {
        throw new Error("Only internal agents can top up partner balances");
      }
    }

    const { totalFee } = await feeService.calculateAgentTopupFee(usdtAmount);
    const netAmount = usdtAmount - totalFee;

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
        reason: `${isAdmin ? callerRole : "Internal agent"} ${callerId} topped up partner ${partnerAgentId}${totalFee > 0 ? ` (net: ${netAmount}, fee: ${totalFee})` : ""}`,
        status: "COMPLETED",
      },
    });

    await agentLedgerService.credit(partnerAgentId, netAmount, "TOPUP", `topup_${callerId}_${partnerAgentId}_${Date.now()}`, `Top-up from ${isAdmin ? callerRole : "internal agent"} ${callerId}`);

    if (!isAdmin) {
      const tx = await prisma.agentTransaction.create({
        data: {
          agentId: callerId,
          type: "TOPUP",
          amount: usdtAmount,
          commission: totalFee,
          netAmount,
          userRef: partnerAgentId,
          status: "COMPLETED",
          reference: generateReferenceNumber(),
          metadata: { targetAgentId: partnerAgentId },
        },
      });

      logger.info(`[Agent] Internal agent ${callerId} topped up partner ${partnerAgentId} with ${usdtAmount} ${ENV.APP_CURRENCY_TOKEN}${totalFee > 0 ? ` (net: ${netAmount}, fee: ${totalFee})` : ""}`);
      return tx;
    }

    logger.info(`[Agent] ${callerRole} ${callerId} topped up partner ${partnerAgentId} with ${usdtAmount} ${ENV.APP_CURRENCY_TOKEN}${totalFee > 0 ? ` (net: ${netAmount}, fee: ${totalFee})` : ""}`);
    return { success: true, amount: netAmount, fee: totalFee, partnerAgentId };
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

  private async fetchAndSyncCrossmintBalance(wallet: AgentWalletRow): Promise<number> {
    if (!wallet.walletLocator) {
      return Number(wallet.balance);
    }
    try {
      const chainType = wallet.chain as ChainType;
      const balances = await crossmintService.getWalletBalance(
        wallet.walletLocator,
        [ENV.APP_CURRENCY_TOKEN.toLowerCase()],
        chainType
      );
      const tokenBalance = balances.tokens?.find(
        (t: any) => t.symbol?.toLowerCase() === ENV.APP_CURRENCY_TOKEN.toLowerCase()
      );
      const liveBalance = tokenBalance ? Number(tokenBalance.amount) : 0;
      if (liveBalance !== Number(wallet.balance)) {
        await prisma.agentWallet.update({
          where: { id: wallet.id },
          data: { balance: liveBalance },
        });
      }
      return liveBalance;
    } catch (error) {
      logger.warn(`[Agent] Failed to fetch Crossmint balance for wallet ${wallet.id}: ${error}`);
      return Number(wallet.balance);
    }
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

    const wallet = agentWallets[0];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTx = agentTransactions.filter((t) => new Date(t.createdAt) >= today);

    const pendingTransfers = await prisma.transfer.findMany({
      where: {
        status: { in: ["PENDING_PAYOUT", "SENT_TO_PARTNER"] },
        OR: [
          { processingAgentId: null },
          { processingAgentId: agentId }
        ]
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const ledgerBalance = await agentLedgerService.getBalance(agentId);

    const walletsWithLiveBalance = await Promise.all(
      agentWallets.map(async (w: AgentWalletRow) => {
        const liveBalance = w.walletLocator
          ? await this.fetchAndSyncCrossmintBalance(w)
          : Number(w.balance);
        return {
          id: w.id,
          network: w.network,
          address: w.address,
          balance: liveBalance,
        };
      })
    );

    const totalWalletBalance = walletsWithLiveBalance.reduce((sum, w) => sum + w.balance, 0);

    return {
      id: agent.id,
      email: agent.email,
      fullName: agent.fullName,
      type: agent.type,
      status: agent.status,
      kpiRating: agent.kpiRating,
      totalRewards: Number(agent.totalRewards),
      ledgerBalance,
      walletBalance: totalWalletBalance,
      walletBalances: walletsWithLiveBalance.map((w) => ({ network: w.network, balance: w.balance })),
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
        metadata: t.metadata,
        createdAt: t.createdAt,
      })),
      wallets: walletsWithLiveBalance,
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

  private async getFirstWallet(agentId: string) {
    const wallet = await prisma.agentWallet.findFirst({
      where: { agentId },
    });
    if (!wallet) throw new Error(`No wallet found for agent ${agentId}`);
    return wallet;
  }

  private async getHotTreasury(chain: string) {
    let hotWallet = await prisma.treasuryWallet.findFirst({
      where: { walletType: "HOT", chain },
    });
    if (!hotWallet) {
      hotWallet = await prisma.treasuryWallet.findFirst({
        where: { walletType: "HOT" },
        orderBy: { createdAt: "asc" },
      });
    }
    if (!hotWallet) throw new Error("Hot treasury wallet not configured for this chain");
    return hotWallet;
  }

  async swapFunds(agentId: string, amount: number, direction: "TO_LEDGER" | "TO_WALLET"): Promise<{ swappedAmount: number; walletBalance: number; ledgerBalance: number }> {
    if (amount <= 0) throw new Error("Amount must be greater than 0");

    const wallet = await this.getFirstWallet(agentId);
    if (!wallet.walletLocator) throw new Error("Agent wallet locator not found");

    const chainType = wallet.chain as ChainType;
    const hotWallet = await this.getHotTreasury(wallet.chain);

    if (direction === "TO_LEDGER") {
      const available = Number(wallet.balance);
      if (available < amount) throw new Error("Insufficient wallet balance");

      let txResult;
      try {
        txResult = await crossmintService.sendTransfer(
          wallet.walletLocator,
          hotWallet.address,
          ENV.APP_CURRENCY_TOKEN.toLowerCase(),
          amount.toString(),
          chainType
        );
      } catch (error) {
        logger.error(`[Agent] Crossmint transfer failed for TO_LEDGER swap (agent ${agentId}):`, error);
        throw new Error("Crossmint transfer failed. Please try again.");
      }

      await prisma.agentWallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: amount } },
      });

      await agentLedgerService.credit(agentId, amount, "SWAP", `crossmint_swap_${agentId}_${Date.now()}`, "Crossmint swap from wallet to ledger");

      await prisma.agentTransaction.create({
        data: {
          agentId,
          type: "SWAP",
          amount,
          commission: 0,
          netAmount: amount,
          status: "COMPLETED",
          reference: generateReferenceNumber(),
          metadata: { direction: "TO_LEDGER", walletId: wallet.id, txHash: txResult.txHash, explorerLink: txResult.explorerLink },
        },
      });
    } else {
      const ledgerBalance = await agentLedgerService.getBalance(agentId);
      if (ledgerBalance < amount) throw new Error("Insufficient ledger balance");

      if (!hotWallet.walletLocator) throw new Error("Hot treasury wallet locator not configured for this chain");

      let txResult;
      try {
        txResult = await crossmintService.sendTransfer(
          hotWallet.walletLocator,
          wallet.address,
          ENV.APP_CURRENCY_TOKEN.toLowerCase(),
          amount.toString(),
          chainType
        );
      } catch (error) {
        logger.error(`[Agent] Crossmint transfer failed for TO_WALLET swap (agent ${agentId}):`, error);
        throw new Error("Crossmint transfer failed. Please try again.");
      }

      await agentLedgerService.debit(agentId, amount, "SWAP", `crossmint_swap_${agentId}_${Date.now()}`, "Crossmint swap from ledger to wallet");

      await prisma.agentWallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: amount } },
      });

      await prisma.agentTransaction.create({
        data: {
          agentId,
          type: "SWAP",
          amount,
          commission: 0,
          netAmount: amount,
          status: "COMPLETED",
          reference: generateReferenceNumber(),
          metadata: { direction: "TO_WALLET", walletId: wallet.id, txHash: txResult.txHash, explorerLink: txResult.explorerLink },
        },
      });
    }

    const newLedgerBalance = await agentLedgerService.getBalance(agentId);
    const updatedWallet = await prisma.agentWallet.findFirst({
      where: { agentId },
    });

    return { swappedAmount: amount, walletBalance: updatedWallet ? Number(updatedWallet.balance) : 0, ledgerBalance: newLedgerBalance };
  }

  async walletWithdraw(agentId: string, amount: number): Promise<void> {
    if (amount <= 0) throw new Error("Amount must be greater than 0");

    const wallet = await this.getFirstWallet(agentId);
    if (!wallet.walletLocator) throw new Error("Agent wallet locator not found");

    const available = Number(wallet.balance);
    if (available < amount) throw new Error("Insufficient wallet balance");

    const hotWallet = await this.getHotTreasury(wallet.chain);
    if (!hotWallet.address) throw new Error("Hot treasury address not configured for this chain");

    const chainType = wallet.chain as ChainType;
    try {
      const result = await crossmintService.sendTransfer(
        wallet.walletLocator,
        hotWallet.address,
        ENV.APP_CURRENCY_TOKEN.toLowerCase(),
        amount.toString(),
        chainType
      );

      await prisma.agentWallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: amount } },
      });

      await prisma.agentTransaction.create({
        data: {
          agentId,
          type: "WALLET_WITHDRAW",
          amount,
          commission: 0,
          netAmount: amount,
          status: "COMPLETED",
          reference: generateReferenceNumber(),
          metadata: { direction: "TO_TREASURY", walletId: wallet.id, txHash: result.txHash, explorerLink: result.explorerLink },
        },
      });

      logger.info(`[Agent] Wallet withdraw ${amount} ${ENV.APP_CURRENCY_TOKEN} from agent ${agentId} wallet to hot treasury: tx=${result.txHash}`);
    } catch (error) {
      logger.error(`[Agent] Crossmint wallet withdraw failed for agent ${agentId} wallet:`, error);
      throw new Error("Wallet withdrawal failed. Please try again.");
    }
  }
}

export const agentService = new AgentService();
