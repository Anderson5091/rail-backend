import { ENV } from "../config/env";
import { logger } from "../utils/logger";

const RELAY_BASE = ENV.RELAY_BASE_URL;

interface RelayQuoteParams {
  user: string;
  recipient: string;
  originChainId: number;
  originCurrency: string;
  destinationChainId: number;
  destinationCurrency: string;
  amount: string;
  tradeType: "EXACT_INPUT" | "EXACT_OUTPUT" | "EXPECTED_OUTPUT";
  useDepositAddress: true;
  strict?: boolean;
  refundTo?: string;
}

interface RelayQuoteResponse {
  steps: {
    id: string;
    requestId: string;
    depositAddress?: string;
    items: { status: string; data?: any; check?: { endpoint: string; method: string } }[];
  }[];
  fees: any;
  details: any;
}

interface RelayRequestStatus {
  status: string;
  inTxHashes: string[];
  txHashes: string[];
  updatedAt: number;
  originChainId: number;
  destinationChainId: number;
  depositAddress?: {
    address: string;
    depositAddressType: string;
    depositor?: string;
    depositTxHash?: string;
  };
  failReason?: string;
  refundFailReason?: string;
}

interface RelayRequestsResponse {
  requests: {
    id: string;
    status: string;
    depositAddress?: {
      address: string;
      depositAddressType: string;
      depositor?: string;
      depositTxHash?: string;
    };
    data?: {
      amount?: string;
      inTxs?: { hash: string; chainId: number; status: string }[];
      outTxs?: { hash: string; chainId: number; status: string }[];
      currencyIn?: { amount: string; amountFormatted: string };
    };
  }[];
}

class RelayService {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = RELAY_BASE;
    this.apiKey = ENV.RELAY_API_KEY;
  }

  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Relay API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async getQuote(params: RelayQuoteParams): Promise<RelayQuoteResponse> {
    return this.request<RelayQuoteResponse>("POST", "/quote/v2", params);
  }

  async getRequestStatus(requestId: string): Promise<RelayRequestStatus> {
    return this.request<RelayRequestStatus>("GET", `/intents/status/v3?requestId=${requestId}`);
  }

  async getRequestsByDepositAddress(depositAddress: string): Promise<RelayRequestsResponse> {
    return this.request<RelayRequestsResponse>("GET", `/requests/v2?depositAddress=${depositAddress}&includeChildRequests=true`);
  }

  async reindexDepositAddress(chainId: number, depositAddress: string, targetChainId?: number, currency?: string): Promise<{ message: string }> {
    return this.request<{ message: string }>("POST", "/transactions/deposit-address/reindex", {
      chainId,
      depositAddress,
      ...(targetChainId && { targetChainId }),
      ...(currency && { currency }),
    });
  }
}

export const relayService = new RelayService();
export type { RelayQuoteParams, RelayQuoteResponse, RelayRequestStatus, RelayRequestsResponse };
