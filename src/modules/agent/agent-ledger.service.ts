import { prisma } from "../../config/database";
import { logger } from "../../utils/logger";
import { ENV } from "../../config/env";
import { crossmintService, type ChainType } from "../../services/crossmint.service";

export class AgentLedgerService {
  async credit(
    agentId: string,
    amount: number,
    category: string,
    reference?: string,
    comment?: string
  ) {
    return prisma.agentLedgerEntry.create({
      data: {
        agentId,
        type: "CREDIT",
        category,
        amount,
        reference,
        comment,
        uniqueKey: reference ? `agent_credit_${reference}` : undefined,
      },
    });
  }

  async debit(
    agentId: string,
    amount: number,
    category: string,
    reference?: string,
    comment?: string
  ) {
    return prisma.agentLedgerEntry.create({
      data: {
        agentId,
        type: "DEBIT",
        category,
        amount,
        reference,
        comment,
        uniqueKey: reference ? `agent_debit_${reference}` : undefined,
      },
    });
  }

  async getBalance(agentId: string): Promise<number> {
    const entries = await prisma.agentLedgerEntry.findMany({
      where: { agentId },
    });

    return entries.reduce((balance: number, entry: { type: string; amount: { toString: () => string } }) => {
      return entry.type === "CREDIT" ? balance + Number(entry.amount) : balance - Number(entry.amount);
    }, 0);
  }

  async getBalanceByCategory(agentId: string, category: string): Promise<number> {
    const entries = await prisma.agentLedgerEntry.findMany({
      where: { agentId, category },
    });

    return entries.reduce((balance: number, entry: { type: string; amount: { toString: () => string } }) => {
      return entry.type === "CREDIT" ? balance + Number(entry.amount) : balance - Number(entry.amount);
    }, 0);
  }

  async autoSwapFromCrossmint(
    agentId: string,
    requiredAmount: number
  ): Promise<number> {
    const balance = await this.getBalance(agentId);
    if (balance >= requiredAmount) return 0;

    const shortfall = requiredAmount - balance;
    if (shortfall <= 0) return 0;

    const wallet = await prisma.agentWallet.findFirst({
      where: { agentId },
    });
    if (!wallet) throw new Error("Agent wallet not found");

    const available = Number(wallet.balance);
    const swapAmount = Math.min(shortfall, available);
    if (swapAmount <= 0) throw new Error("Insufficient agent balance in both ledger and Crossmint wallet");

    const hotWallet = await prisma.treasuryWallet.findFirst({
      where: { walletType: "HOT", chain: wallet.chain },
    });

    if (wallet.walletLocator && hotWallet?.address) {
      const chainType = wallet.chain as ChainType;
      try {
        await crossmintService.sendTransfer(
          wallet.walletLocator,
          hotWallet.address,
          ENV.APP_CURRENCY_TOKEN.toLowerCase(),
          swapAmount.toString(),
          chainType
        );
      } catch (error) {
        logger.error(`[AgentLedger] Crossmint transfer failed during auto-swap for agent ${agentId}:`, error);
        throw new Error("Crossmint transfer failed during auto-swap");
      }
    }

    await prisma.agentWallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: swapAmount } },
    });

    await this.credit(agentId, swapAmount, "SWAP", `auto_swap_${agentId}_${Date.now()}`, "Auto-swap from Crossmint wallet");

    logger.info(`[AgentLedger] Auto-swapped ${swapAmount} ${ENV.APP_CURRENCY_TOKEN} from Crossmint wallet for agent ${agentId}`);
    return swapAmount;
  }

  async ensureBalance(agentId: string, requiredAmount: number): Promise<void> {
    const balance = await this.getBalance(agentId);
    if (balance >= requiredAmount) return;

    const swapped = await this.autoSwapFromCrossmint(agentId, requiredAmount);
    const newBalance = balance + swapped;
    if (newBalance < requiredAmount) {
      throw new Error("Insufficient agent balance after Crossmint swap");
    }
  }
}

export const agentLedgerService = new AgentLedgerService();
