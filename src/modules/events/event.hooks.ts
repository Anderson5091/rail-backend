import { eventEmitter } from "./event.emitter";
import { notificationService } from "../notifications/notification.service";
import { logger } from "../../utils/logger";
import type { EventPayload } from "./event.types";

const eventNotificationMap: Record<string, { type: string; title: string; messageTemplate: string }> = {
  TRANSFER_CREATED: { type: "TRANSFER_UPDATE", title: "Transfer Created", messageTemplate: "Your transfer of {{amount}} has been initiated." },
  TRANSFER_PENDING: { type: "TRANSFER_UPDATE", title: "Transfer Pending", messageTemplate: "Your transfer of {{amount}} is being processed." },
  TRANSFER_COMPLETED: { type: "TRANSFER_UPDATE", title: "Transfer Completed", messageTemplate: "Your transfer of {{amount}} has been completed successfully." },
  TRANSFER_FAILED: { type: "TRANSFER_UPDATE", title: "Transfer Failed", messageTemplate: "Your transfer of {{amount}} has failed." },
  PAYOUT_SENT: { type: "PAYOUT_UPDATE", title: "Payout Sent", messageTemplate: "Your payout of {{amount}} has been sent." },
  PAYOUT_CONFIRMED: { type: "PAYOUT_UPDATE", title: "Payout Confirmed", messageTemplate: "Your payout of {{amount}} has been confirmed." },
  PAYOUT_FAILED: { type: "PAYOUT_UPDATE", title: "Payout Failed", messageTemplate: "Your payout of {{amount}} has failed." },
  PAYOUT_RETRYING: { type: "PAYOUT_UPDATE", title: "Payout Retrying", messageTemplate: "We are retrying your payout of {{amount}}." },
  KYC_APPROVED: { type: "KYC_UPDATE", title: "KYC Approved", messageTemplate: "Your KYC application has been approved." },
  KYC_REJECTED: { type: "KYC_UPDATE", title: "KYC Rejected", messageTemplate: "Your KYC application has been rejected. Reason: {{reason}}." },
  AML_FLAGGED: { type: "COMPLIANCE_ALERT", title: "Compliance Alert", messageTemplate: "Your account has been flagged for compliance review." },
  ACCOUNT_BLOCKED: { type: "SECURITY_ALERT", title: "Account Blocked", messageTemplate: "Your account has been temporarily blocked." },
  LIQUIDITY_LOW: { type: "TREASURY_ALERT", title: "Liquidity Low", messageTemplate: "Liquidity for {{network}} is below threshold." },
  REBALANCE_TRIGGERED: { type: "TREASURY_ALERT", title: "Rebalance Triggered", messageTemplate: "Treasury rebalance initiated for {{network}}." },
  DEPOSIT_RECEIVED: { type: "WALLET_ALERT", title: "Deposit Received", messageTemplate: "{{amount}} USDT has been deposited to your wallet." },
  WITHDRAWAL_PROCESSED: { type: "WALLET_ALERT", title: "Withdrawal Processed", messageTemplate: "{{amount}} USDT has been withdrawn from your wallet." },
};

export function registerEventHooks() {
  const events = Object.keys(eventNotificationMap);

  for (const eventType of events) {
    eventEmitter.on(eventType as any, async (payload: EventPayload) => {
      const config = eventNotificationMap[eventType];
      if (!config || !payload.userId) return;

      const message = config.messageTemplate.replace(/\{\{(\w+)\}\}/g, (_, key) =>
        String(payload.metadata?.[key] ?? key)
      );

      try {
        await notificationService.send({
          userId: payload.userId,
          type: config.type as any,
          channel: "IN_APP",
          title: config.title,
          message,
          metadata: payload.metadata,
        });
      } catch (error) {
        logger.error(`Failed to create notification for event ${eventType}`, error);
      }
    });
  }

  logger.info(`[EVENT_HOOKS] Registered ${events.length} event notification hooks`);
}
