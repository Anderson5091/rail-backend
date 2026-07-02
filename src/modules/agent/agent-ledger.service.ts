import { prisma } from "../../config/database";
import { logger } from "../../utils/logger";

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
      where: { agentId, walletType: "MAIN" },
    });
    if (!wallet) throw new Error("Agent MAIN wallet not found");

    const available = Number(wallet.balance);
    const swapAmount = Math.min(shortfall, available);
    if (swapAmount <= 0) throw new Error("Insufficient agent balance in both ledger and Crossmint wallet");

    await prisma.agentWallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: swapAmount } },
    });

    await this.credit(agentId, swapAmount, "SWAP", `auto_swap_${agentId}_${Date.now()}`, "Auto-swap from Crossmint wallet");

    logger.info(`[AgentLedger] Auto-swapped ${swapAmount} USDT from Crossmint wallet for agent ${agentId}`);
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
