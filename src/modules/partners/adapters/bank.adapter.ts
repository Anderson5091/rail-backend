import { BasePartnerAdapter, type PayoutRequestData, type PayoutResponse } from "./base.adapter";

export class BankAdapter extends BasePartnerAdapter {
  async sendPayout(data: PayoutRequestData): Promise<PayoutResponse> {
    console.log(`[BANK_ADAPTER] Sending ${data.amount} to ${data.bankName} account ${data.accountNumber}`);
    return {
      status: "SUCCESS",
      externalReference: `BANK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message: "Bank transfer initiated",
    };
  }

  async checkStatus(reference: string): Promise<{ status: string; [key: string]: unknown }> {
    console.log(`[BANK_ADAPTER] Checking status for ${reference}`);
    return { status: "DELIVERED", reference };
  }
}
