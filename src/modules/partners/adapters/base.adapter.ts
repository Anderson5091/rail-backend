export interface PayoutRequestData {
  amount: number;
  currency?: string;
  reference: string;
  beneficiaryName?: string;
  bankName?: string;
  accountNumber?: string;
  phoneNumber?: string;
  provider?: string;
  location?: string;
  recipientName?: string;
  [key: string]: unknown;
}

export interface PayoutResponse {
  status: string;
  externalReference: string;
  message?: string;
}

export abstract class BasePartnerAdapter {
  abstract sendPayout(data: PayoutRequestData): Promise<PayoutResponse>;
  abstract checkStatus(reference: string): Promise<{ status: string; [key: string]: unknown }>;
}
