import { prisma } from "../../config/database";

export class RiskEngine {
  async calculate(userId: string, transaction: { amount: number }) {
    let score = 0;
    const factors: string[] = [];

    if (transaction.amount > 500) { score += 30; factors.push("Amount exceeds $500"); }
    if (transaction.amount > 1000) { score += 50; factors.push("Amount exceeds $1,000"); }

    const kyc = await prisma.kycProfile.findUnique({ where: { userId } });
    if (kyc && kyc.tier === 1) { score += 20; factors.push("KYC Tier 1"); }

    const level = score < 30 ? "LOW" : score < 60 ? "MEDIUM" : score < 85 ? "HIGH" : "CRITICAL";

    await prisma.riskScore.upsert({
      where: { userId },
      update: { score, level, factors },
      create: { userId, score, level, factors },
    });

    return { score, level, factors };
  }
}

export const riskEngine = new RiskEngine();
