import { prisma } from "../../config/database";

export class AmlService {
  async analyze(transaction: { amount: number; userId: string }) {
    const flags: string[] = [];

    if (transaction.amount > 1000) {
      flags.push("HIGH_VALUE_TRANSFER");
    }

    const recentCount = await prisma.transfer.count({
      where: {
        userId: transaction.userId,
        createdAt: { gte: new Date(Date.now() - 86400000) },
      },
    });

    if (recentCount > 5) {
      flags.push("HIGH_FREQUENCY");
    }

    const riskLevel = flags.length > 1 ? "HIGH" : flags.length === 1 ? "MEDIUM" : "LOW";

    const check = await prisma.amlCheck.create({
      data: {
        userId: transaction.userId,
        riskLevel,
        flags,
      },
    });

    return { riskLevel, flags, id: check.id };
  }
}

export const amlService = new AmlService();
