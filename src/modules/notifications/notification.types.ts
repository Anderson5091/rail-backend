export type NotificationChannel = "EMAIL" | "SMS" | "PUSH" | "IN_APP";

export type NotificationStatus = "PENDING" | "SENT" | "FAILED" | "READ";

export type NotificationType =
  | "TRANSFER_UPDATE"
  | "PAYOUT_UPDATE"
  | "KYC_UPDATE"
  | "COMPLIANCE_ALERT"
  | "TREASURY_ALERT"
  | "WALLET_ALERT"
  | "SECURITY_ALERT";

export interface CreateNotificationDto {
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationResult {
  id: string;
  userId: string | null;
  type: string | null;
  channel: string | null;
  title: string | null;
  message: string | null;
  status: string | null;
  createdAt: Date;
}
