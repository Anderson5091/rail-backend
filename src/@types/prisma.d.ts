declare module "@prisma/client" {
  class PrismaClient {
    constructor(options?: any);
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
    $transaction: any;
    $on: any;
    user: any;
    wallet: any;
    walletAddress: any;
    walletTransaction: any;
    ledgerEntry: any;
    beneficiary: any;
    fxRate: any;
    feeRule: any;
    transfer: any;
    payoutOrder: any;
    payoutEvent: any;
    partnerLog: any;
    treasuryWallet: any;
    treasuryMovement: any;
    liquiditySnapshot: any;
    kycProfile: any;
    kycDocument: any;
    amlCheck: any;
    sanctionsHit: any;
    complianceCase: any;
    riskScore: any;
    idempotencyKey: any;
    event: any;
    notification: any;
    notificationDelivery: any;
    adminUser: any;
    adminActionLog: any;
    systemAlert: any;
  }
  export { PrismaClient };
}
