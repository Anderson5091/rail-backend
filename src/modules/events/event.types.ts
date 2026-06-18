export type EventType =
  | "TRANSFER_CREATED"
  | "TRANSFER_PENDING"
  | "TRANSFER_COMPLETED"
  | "TRANSFER_FAILED"
  | "PAYOUT_SENT"
  | "PAYOUT_CONFIRMED"
  | "PAYOUT_FAILED"
  | "PAYOUT_RETRYING"
  | "KYC_APPROVED"
  | "KYC_REJECTED"
  | "AML_FLAGGED"
  | "ACCOUNT_BLOCKED"
  | "LIQUIDITY_LOW"
  | "REBALANCE_TRIGGERED"
  | "COLD_STORAGE_SWEEP"
  | "DEPOSIT_RECEIVED"
  | "WITHDRAWAL_PROCESSED"
  | "BENEFICIARY_ADDED";

export interface EventPayload {
  eventType: EventType;
  entity: string;
  entityId: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export type EventHandler = (payload: EventPayload) => Promise<void>;
