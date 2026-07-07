import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createServer } from "http";
import { ENV } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { apiLimiter, authLimiter, adminLimiter, kycLimiter } from "./middleware/rateLimiter";
import { wafMiddleware, apiGatewayMiddleware } from "./middleware/security/waf.middleware";
import { authRoutes } from "./modules/auth/auth.routes";
import { userRoutes } from "./modules/user/user.routes";
import { walletRoutes } from "./modules/wallet/wallet.routes";
import { beneficiaryRoutes } from "./modules/beneficiary/beneficiary.routes";
import { transferRoutes } from "./modules/transfer/transfer.routes";
import { payoutRoutes } from "./modules/payout/payout.routes";
import { treasuryRoutes } from "./modules/treasury/treasury.routes";
import { kycRoutes } from "./modules/kyc/kyc.routes";
import { adminRoutes } from "./modules/admin/admin.routes";
import { adminAuthRoutes } from "./modules/admin/admin-auth.routes";
import { adminRevenueRoutes } from "./modules/admin/admin-revenue.routes";
import { webhookRoutes } from "./modules/webhook/webhook.routes";
import { notificationRoutes } from "./modules/notifications/notification.routes";
import { partnerRoutes } from "./modules/partners/partners.routes";
import { productionRoutes } from "./modules/production/production.routes";
import { depositRoutes } from "./modules/deposit/deposit.routes";
import { withdrawalRoutes } from "./modules/withdrawal/withdrawal.routes";
import { agentRoutes } from "./modules/agent/agent.routes";
import { agentAuthRoutes } from "./modules/agent/agent-auth.routes";
import { feeRoutes } from "./modules/fees/fee.routes";
import { publicFeeRoutes } from "./modules/fees/public-fee.routes";

const app = express();
const httpServer = createServer(app);

app.use(helmet());
app.use(cors({
  origin: ENV.CORS_ORIGINS,
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));
app.use(wafMiddleware);
app.use(apiGatewayMiddleware);
app.use("/api", apiLimiter);

app.get("/health", async (_req, res) => {
  const { healthController } = await import("./modules/production/health/health.controller");
  await healthController.check(_req, res);
});

app.use("/api/v1/auth", authLimiter, authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/wallet", walletRoutes);
app.use("/api/v1/deposits", depositRoutes);
app.use("/api/v1/withdrawals", withdrawalRoutes);
app.use("/api/v1/beneficiaries", beneficiaryRoutes);
app.use("/api/v1/transfers", transferRoutes);
app.use("/api/v1/payout", payoutRoutes);
app.use("/api/v1/treasury", treasuryRoutes);
app.use("/api/v1/kyc", kycLimiter, kycRoutes);
app.use("/api/v1/admin", adminLimiter, adminRoutes);
app.use("/api/v1/webhook", webhookRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/partners", partnerRoutes);
app.use("/api/v1/admin/auth", adminAuthRoutes);
app.use("/api/v1/production", productionRoutes);
app.use("/api/v1/agent", agentRoutes);
app.use("/api/v1/agent/auth", agentAuthRoutes);
app.use("/api/v1/admin/fees", feeRoutes);
app.use("/api/v1/admin/revenue", adminRevenueRoutes);
app.use("/api/v1/fees", publicFeeRoutes);

app.use(errorHandler);

export { app, httpServer };
export default app;
