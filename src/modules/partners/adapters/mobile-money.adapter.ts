import { BasePartnerAdapter, type PayoutRequestData, type PayoutResponse } from "./base.adapter";

export class MobileMoneyAdapter extends BasePartnerAdapter {
  async sendPayout(data: PayoutRequestData): Promise<PayoutResponse> {
    console.log(`[MOBILE_MONEY_ADAPTER] Sending ${data.amount} to ${data.provider} number ${data.phoneNumber}`);
    return {
      status: "SUCCESS",
      externalReference: `MM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message: "Mobile money transfer sent",
    };
  }

  async checkStatus(reference: string): Promise<{ status: string; [key: string]: unknown }> {
    console.log(`[MOBILE_MONEY_ADAPTER] Checking status for ${reference}`);
    return { status: "DELIVERED", reference };
  }
}
