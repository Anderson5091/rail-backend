import crypto from "crypto";
import { Request, Response } from "express";
import { ENV } from "../../config/env";
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
    const signature = req.headers["x-crossmint-signature"] as string | undefined;
    const payload = req.body as CrossmintWebhookPayload;

    if (!this.verifySignature(req, signature)) {
      return;
    }

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

  private verifySignature(req: Request, signature: string | undefined): boolean {
    const secret = ENV.CROSSMINT_WEBHOOK_SECRET;
    if (!secret) {
      if (signature) {
        logger.warn("[CrossmintWebhook] Signature present but CROSSMINT_WEBHOOK_SECRET not configured — skipping validation");
      }
      return true;
    }

    if (!signature) {
      logger.warn("[CrossmintWebhook] Missing x-crossmint-signature header");
      return true;
    }

    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      logger.warn("[CrossmintWebhook] Raw body not available for signature verification");
      return true;
    }

    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      logger.error("[CrossmintWebhook] Invalid webhook signature — possible spoofed event");
      return false;
    }

    return true;
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

    const depositRequestId = await depositService.handleDepositDetected(walletId, txHash, amount, chain);

    if (!depositRequestId) {
      logger.warn("[CrossmintWebhook] No deposit request found for wallet:", walletId);
      return;
    }

    await depositService.approveDeposit(depositRequestId);

    await depositService.sweepToHotTreasury(depositRequestId);

    await depositService.creditUserBalance(depositRequestId);
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
