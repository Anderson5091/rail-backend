import { BasePartnerAdapter, type PayoutRequestData, type PayoutResponse } from "./base.adapter";

export class CashPickupAdapter extends BasePartnerAdapter {
  async sendPayout(data: PayoutRequestData): Promise<PayoutResponse> {
    console.log(`[CASH_ADAPTER] Sending ${data.amount} to ${data.location} for ${data.recipientName}`);
    return {
      status: "READY_FOR_PICKUP",
      externalReference: `CASH-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message: "Cash pickup ready",
    };
  }

  async checkStatus(reference: string): Promise<{ status: string; [key: string]: unknown }> {
    console.log(`[CASH_ADAPTER] Checking status for ${reference}`);
    return { status: "AVAILABLE", reference, pickupCode: `PC-${reference.slice(-6)}` };
  }
}
