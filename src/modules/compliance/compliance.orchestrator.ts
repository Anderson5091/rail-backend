import { prisma } from "../../config/database";
import { AmlService } from "../aml/aml.service";
import { SanctionsService } from "../sanctions/sanctions.service";
import { RiskEngine } from "../risk/risk.service";

export class ComplianceOrchestrator {
  private aml = new AmlService();
  private sanctions = new SanctionsService();
  private risk = new RiskEngine();

  async evaluate(user: { id: string; fullName?: string }, transaction: { amount: number; userId: string }) {
    const amlResult = await this.aml.analyze(transaction);
    const sanctionsResult = await this.sanctions.check(user.fullName || "");
    const riskResult = await this.risk.calculate(user.id, transaction);

    let decision = "APPROVE";
    if (sanctionsResult.match) decision = "BLOCK";
    else if (riskResult.level === "CRITICAL") decision = "BLOCK";
    else if (riskResult.level === "HIGH") decision = "REVIEW";

    await prisma.complianceCase.create({
      data: {
        userId: user.id,
        transactionId: transaction.userId,
        status: decision === "APPROVE" ? "RESOLVED" : "OPEN",
        reason: `Risk: ${riskResult.level}, AML: ${amlResult.riskLevel}`,
      },
    });

    return { status: decision, risk: riskResult, aml: amlResult };
  }
}

export const complianceOrchestrator = new ComplianceOrchestrator();
