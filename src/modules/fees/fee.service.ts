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
}

export const feeService = new FeeService();
