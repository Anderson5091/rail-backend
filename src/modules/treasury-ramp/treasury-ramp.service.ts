import { prisma } from "../../config/database";
import { ENV } from "../../config/env";
import { crossmintService } from "../../services/crossmint.service";
import { logger } from "../../utils/logger";

const CHAIN_MAP: Record<string, { chain: string; network: string }> =
  Object.fromEntries(
    ENV.SUPPORTED_NETWORKS.map((net, i) => [
      net,
      { chain: ENV.NETWORK_CHAIN[i] || net.toLowerCase(), network: net },
    ])
  );

export class TreasuryRampService {
  async getOnrampInfo() {
    const bankAccounts = await prisma.treasuryBankAccount.findMany({
      where: { status: "ACTIVE" },
    });

    if (bankAccounts.length === 0) {
      const envPaymentMethodId = process.env.CROSSMINT_OFFRAMP_PAYMENT_METHOD_ID;
      if (envPaymentMethodId) {
        return {
          instructions: "Send a bank transfer with the memo code to fund your treasury wallet. Contact Crossmint for specific instructions.",
          bankAccounts: [{ paymentMethodId: envPaymentMethodId, bankName: "Crossmint", currency: "USD" }],
        };
      }
      return {
        instructions: "No bank accounts configured. Contact Crossmint to register a bank account for treasury funding.",
        bankAccounts: [],
      };
    }

    return {
      instructions: "Send a bank transfer using the memo code provided for your treasury wallet. Crossmint will convert and deposit stablecoins automatically.",
      bankAccounts: bankAccounts.map((a: { id: string; bankName: string | null; accountSuffix: string | null; currency: string; isDefault: boolean }) => ({
        id: a.id,
        bankName: a.bankName,
        accountSuffix: a.accountSuffix,
        currency: a.currency,
        isDefault: a.isDefault,
      })),
    };
  }

  async createOfframpOrder(params: {
    chain: string;
    amount: number;
    paymentMethodId?: string;
    createdBy?: string;
    sourceWalletType?: string;
  }) {
    const mapping = CHAIN_MAP[params.chain.toUpperCase()];
    if (!mapping) {
      throw new Error(`Unsupported chain: ${params.chain}`);
    }

    const walletType = params.sourceWalletType?.toUpperCase() || "HOT";
    const sourceWallet = await prisma.treasuryWallet.findFirst({
      where: { walletType, chain: mapping.chain },
    });

    if (!sourceWallet?.address) {
      throw new Error(`No ${walletType} treasury wallet found for this chain`);
    }

    let paymentMethodId = params.paymentMethodId;

    if (!paymentMethodId) {
      const defaultAccount = await prisma.treasuryBankAccount.findFirst({
        where: { status: "ACTIVE", isDefault: true },
      });
      paymentMethodId = defaultAccount?.paymentMethodId || process.env.CROSSMINT_OFFRAMP_PAYMENT_METHOD_ID;
    }

    if (!paymentMethodId) {
      throw new Error("No payment method configured for offramp. Set CROSSMINT_OFFRAMP_PAYMENT_METHOD_ID env or create a bank account.");
    }

    const result = await crossmintService.createTreasuryOfframpOrder({
      payerAddress: sourceWallet.address,
      chain: mapping.chain,
      paymentMethodId,
      amount: params.amount.toString(),
    });

    const offrampOrder = await prisma.treasuryOfframpOrder.create({
      data: {
        paymentMethodId,
        chain: mapping.chain.toUpperCase(),
        amount: params.amount,
        netAmount: params.amount,
        fiatAmount: params.amount,
        status: "AWAITING_PAYMENT",
        crossmintOrderId: result.orderId,
        treasuryWalletId: sourceWallet.id,
        fromWalletType: walletType,
        createdBy: params.createdBy || "SYSTEM",
      },
    });

    logger.info(`[TreasuryRamp] Offramp order ${offrampOrder.id} created (crossmint: ${result.orderId})`);

    return {
      id: offrampOrder.id,
      crossmintOrderId: result.orderId,
      status: "AWAITING_PAYMENT",
      serializedTransaction: result.serializedTransaction,
      memo: result.memo,
      chain: mapping.chain,
      payerAddress: sourceWallet.address,
      amount: params.amount,
      sourceWalletType: walletType,
    };
  }

  async executeOfframpOrder(orderId: string) {
    const order = await prisma.treasuryOfframpOrder.findUnique({
      where: { id: orderId },
      include: { treasuryWallet: true },
    });

    if (!order) throw new Error("Offramp order not found");
    if (order.status !== "AWAITING_PAYMENT") {
      throw new Error(`Order ${orderId} is in status ${order.status}, expected AWAITING_PAYMENT`);
    }

    if (!order.crossmintOrderId) {
      throw new Error("No Crossmint order ID for this offramp order");
    }

    const hotWallet = order.treasuryWallet;
    if (!hotWallet?.walletLocator) {
      throw new Error("Treasury wallet locator not found");
    }

    const mapping = CHAIN_MAP[order.chain.toUpperCase()];
    if (!mapping) throw new Error(`Unsupported chain: ${order.chain}`);

    try {
      const status = await crossmintService.getOrderStatus(order.crossmintOrderId);

      if (status.phase === "completed" || status.payment?.status === "completed") {
        const txId = status.payment?.received?.txId;
        await prisma.treasuryOfframpOrder.update({
          where: { id: orderId },
          data: {
            status: "COMPLETED",
            txHash: txId,
          },
        });

        logger.info(`[TreasuryRamp] Offramp ${orderId} completed: tx=${txId}`);
        return { status: "COMPLETED", txHash: txId };
      }

      if (status.phase === "payment" && status.payment?.status === "awaiting-payment") {
        const payment = status.payment as any;
        const preparation = payment?.preparation;
        if (preparation?.serializedTransaction) {
          return {
            status: "AWAITING_PAYMENT",
            serializedTransaction: preparation.serializedTransaction,
            memo: preparation?.transactionParameters?.memo,
          };
        }
      }

      await prisma.treasuryOfframpOrder.update({
        where: { id: orderId },
        data: { status: "PROCESSING" },
      });

      return { status: "PROCESSING" };
    } catch (error: any) {
      await prisma.treasuryOfframpOrder.update({
        where: { id: orderId },
        data: {
          status: "FAILED",
          failureReason: error.message,
        },
      });
      logger.error(`[TreasuryRamp] Offramp execution failed for ${orderId}:`, error);
      throw error;
    }
  }

  async confirmOfframpOrder(orderId: string, txHash: string) {
    const order = await prisma.treasuryOfframpOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) throw new Error("Offramp order not found");

    await prisma.treasuryOfframpOrder.update({
      where: { id: orderId },
      data: {
        status: "COMPLETED",
        txHash,
      },
    });

    logger.info(`[TreasuryRamp] Offramp ${orderId} confirmed with tx: ${txHash}`);
  }

  async createOnrampTransfer(params: {
    chain: string;
    fiatAmount: number;
    memoCode?: string;
    notes?: string;
    destinationWalletType?: string;
  }) {
    const mapping = CHAIN_MAP[params.chain.toUpperCase()];
    if (!mapping) throw new Error(`Unsupported chain: ${params.chain}`);

    const walletType = params.destinationWalletType?.toUpperCase() || "HOT";
    const destWallet = await prisma.treasuryWallet.findFirst({
      where: { walletType, chain: mapping.chain },
    });

    if (!destWallet) throw new Error(`No ${walletType} treasury wallet found for this chain`);

    const transfer = await prisma.treasuryOnrampTransfer.create({
      data: {
        fiatAmount: params.fiatAmount,
        chain: mapping.chain.toUpperCase(),
        status: "PENDING",
        treasuryWalletId: destWallet.id,
        memoCode: params.memoCode,
        notes: params.notes,
      },
    });

    logger.info(`[TreasuryRamp] Onramp transfer ${transfer.id} recorded (${params.fiatAmount} USD -> ${mapping.chain} ${walletType})`);

    return {
      id: transfer.id,
      status: "PENDING",
      memoCode: params.memoCode,
      destinationWalletType: walletType,
      instructions: `Send ${params.fiatAmount} USD via bank transfer. Include memo code ${params.memoCode || "provided by Crossmint"} to ensure proper credit.`,
    };
  }

  async getOfframpOrders() {
    return prisma.treasuryOfframpOrder.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        treasuryWallet: {
          select: { walletType: true, network: true, address: true },
        },
      },
    });
  }

  async getOnrampTransfers() {
    return prisma.treasuryOnrampTransfer.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        treasuryWallet: {
          select: { walletType: true, network: true, address: true },
        },
      },
    });
  }

  async createCardDeposit(params: {
    chain: string;
    amount: number;
    receiptEmail?: string;
    createdBy?: string;
    destinationWalletType?: string;
  }) {
    const mapping = CHAIN_MAP[params.chain.toUpperCase()];
    if (!mapping) throw new Error(`Unsupported chain: ${params.chain}`);

    const walletType = params.destinationWalletType?.toUpperCase() || "HOT";
    const destWallet = await prisma.treasuryWallet.findFirst({
      where: { walletType, chain: mapping.chain },
    });

    if (!destWallet?.address) {
      throw new Error(`No ${walletType} treasury wallet found for this chain`);
    }

    const result = await crossmintService.createCardOnrampOrder({
      walletAddress: destWallet.address,
      chain: mapping.chain,
      amount: params.amount.toString(),
      receiptEmail: params.receiptEmail,
    });

    const deposit = await prisma.treasuryOnrampTransfer.create({
      data: {
        fiatAmount: params.amount,
        chain: mapping.chain.toUpperCase(),
        status: "AWAITING_PAYMENT",
        treasuryWalletId: destWallet.id,
        crossmintOrderId: result.orderId,
        notes: `Card deposit → ${walletType} — client secret: ${result.clientSecret.slice(0, 20)}...`,
      },
    });

    logger.info(`[TreasuryRamp] Card deposit ${deposit.id} created (order: ${result.orderId}, dest: ${walletType})`);

    return {
      id: deposit.id,
      orderId: result.orderId,
      clientSecret: result.clientSecret,
      status: "AWAITING_PAYMENT",
      walletAddress: destWallet.address,
      walletType,
      chain: mapping.chain,
      amount: params.amount,
    };
  }

  async listBankAccounts() {
    return prisma.treasuryBankAccount.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  async addBankAccount(data: {
    bankName: string;
    accountSuffix?: string;
    routingNumber?: string;
    paymentMethodId: string;
    currency?: string;
    isDefault?: boolean;
  }) {
    if (data.isDefault) {
      await prisma.treasuryBankAccount.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    return prisma.treasuryBankAccount.create({
      data: {
        bankName: data.bankName,
        accountSuffix: data.accountSuffix,
        routingNumber: data.routingNumber,
        paymentMethodId: data.paymentMethodId,
        currency: data.currency || "USD",
        isDefault: data.isDefault || false,
      },
    });
  }

  async removeBankAccount(id: string) {
    const account = await prisma.treasuryBankAccount.findUnique({ where: { id } });
    if (!account) throw new Error("Bank account not found");

    await prisma.treasuryBankAccount.update({
      where: { id },
      data: { status: "INACTIVE" },
    });

    return { success: true };
  }
}

export const treasuryRampService = new TreasuryRampService();
