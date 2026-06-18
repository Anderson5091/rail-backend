export class AuditService {
  async log(data: { user: any; transaction: any; aml: any; risk: any; sanctions: any; decision: string }) {
    console.log("[AUDIT]", JSON.stringify(data, null, 2));
  }
}

export const auditService = new AuditService();
