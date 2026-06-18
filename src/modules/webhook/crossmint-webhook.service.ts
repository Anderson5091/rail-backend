import { Request, Response } from "express";
import { depositService } from "../deposit/deposit.service";
import { logger } from "../../utils/logger";

interface CrossmintWebhookPayload {
  type: string;
  data: {
    walletId?: string;
    walletLocator?: string;
    txHash?: string;
    transactionId?: string;
    amount?: string;
    token?: string;
    chain?: string;
    fromAddress?: string;
    toAddress?: string;
    status?: string;
    [key: string]: unknown;
  };
}

export class CrossmintWebhookService {
  async handleWebhook(req: Request, res: Response) {
    const signature = req.headers["x-crossmint-signature"] as string;
    const payload = req.body as CrossmintWebhookPayload;

    logger.info(`[CrossmintWebhook] Received event: ${payload.type}`);

    try {
      switch (payload.type) {
        case "deposit.detected.v1":
        case "wallet:transaction:received":
          await this.handleDepositDetected(payload);
          break;

        case "wallet:transaction:sent":
          await this.handleTransferSent(payload);
          break;

        case "wallet:transaction:confirmed":
          await this.handleTransactionConfirmed(payload);
          break;

        default:
          logger.info(`[CrossmintWebhook] Unhandled event type: ${payload.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      logger.error(`[CrossmintWebhook] Error processing ${payload.type}:`, error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  }

  private async handleDepositDetected(payload: CrossmintWebhookPayload) {
    const { data } = payload;
    const walletId = data.walletId || data.walletLocator || "";
    const txHash = data.txHash || data.transactionId || "";
    const amount = parseFloat(data.amount || "0");
    const chain = data.chain || "";

    if (!walletId || !txHash || amount <= 0) {
      logger.warn("[CrossmintWebhook] Invalid deposit detected payload:", data);
      return;
    }

    await depositService.handleDepositDetected(walletId, txHash, amount, chain);

    await depositService.approveDeposit(walletId);

    await depositService.sweepToHotTreasury(walletId);

    await depositService.creditUserBalance(walletId);
  }

  private async handleTransferSent(payload: CrossmintWebhookPayload) {
    const { data } = payload;
    logger.info(`[CrossmintWebhook] Transfer sent: ${data.txHash || data.transactionId}`);
  }

  private async handleTransactionConfirmed(payload: CrossmintWebhookPayload) {
    const { data } = payload;
    logger.info(`[CrossmintWebhook] Transaction confirmed: ${data.txHash || data.transactionId}`);
  }
}

export const crossmintWebhookService = new CrossmintWebhookService();
