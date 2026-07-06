import { prisma } from "../../config/database";

export class FeeService {
  async calculate(country: string, method: string, amount: number) {
    const rule = await prisma.feeRule.findFirst({
      where: { country, payoutMethod: method },
    });

    if (rule) {
      return {
        fee: Number(rule.fixedFee) + amount * Number(rule.percentFee) / 100,
        fixedFee: Number(rule.fixedFee),
        percentFee: Number(rule.percentFee),
      };
    }

    const fixedFee = 2;
    const percentFee = amount * 0.01;
    return { fee: fixedFee + percentFee, fixedFee, percentFee };
  }

  async getConfig(transactionType: string) {
    return prisma.feeConfig.findUnique({ where: { transactionType } });
  }

  private computeFee(mode: string, fixedFee: number, percentFee: number, amount: number): number {
    let fee = 0;
    if (mode === "FIXED" || mode === "BOTH") fee += fixedFee;
    if (mode === "PERCENTAGE" || mode === "BOTH") fee += amount * percentFee / 100;
    return fee;
  }

  async calculateByTransactionType(transactionType: string, amount: number) {
    const config = await prisma.feeConfig.findUnique({ where: { transactionType } });
    if (!config || !config.enabled) {
      return { systemFee: 0, processingFee: 0, totalFee: 0 };
    }

    let systemFee = 0;
    let processingFee = 0;

    if (config.systemFeeEnabled) {
      systemFee = this.computeFee(
        config.systemFeeMode,
        Number(config.systemFixedFee),
        Number(config.systemPercentFee),
        amount
      );
    }

    if (config.processingFeeEnabled) {
      processingFee = this.computeFee(
        config.processingFeeMode,
        Number(config.processingFixedFee),
        Number(config.processingPercentFee),
        amount
      );
    }

    return {
      systemFee,
      processingFee,
      totalFee: systemFee + processingFee,
    };
  }

  async calculateDepositFee(amount: number) {
    return this.calculateByTransactionType("WEB_DEPOSIT", amount);
  }

  async calculateWithdrawalFee(amount: number, _network: string) {
    return this.calculateByTransactionType("WEB_WITHDRAW", amount);
  }

  async calculateTransferFee(amount: number) {
    return this.calculateByTransactionType("WEB_TRANSFER", amount);
  }

  async calculateAgentTransferFee(amount: number) {
    return this.calculateByTransactionType("AGENT_TRANSFER", amount);
  }

  async calculateAgentDepositFee(amount: number) {
    return this.calculateByTransactionType("AGENT_DEPOSIT", amount);
  }

  async calculateAgentCashWithdrawFee(amount: number) {
    return this.calculateByTransactionType("AGENT_CASH_WITHDRAW", amount);
  }

  async calculatePayoutFee(amount: number) {
    return this.calculateByTransactionType("PAYOUT", amount);
  }

  async calculateP2pFee(amount: number) {
    return this.calculateByTransactionType("P2P", amount);
  }

  async calculateAgentTopupFee(amount: number) {
    return this.calculateByTransactionType("AGENT_TOPUP", amount);
  }
}

export const feeService = new FeeService();
