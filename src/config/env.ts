import dotenv from "dotenv";
dotenv.config();

export const ENV = {
  PORT: parseInt(process.env.PORT || "3001", 10),
  NODE_ENV: process.env.NODE_ENV || "development",
  DATABASE_URL: process.env.DATABASE_URL || "",
  JWT_SECRET: process.env.JWT_SECRET || "change-me",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "15m",
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN || "7d",
  CORS_ORIGINS: (process.env.CORS_ORIGIN || "http://localhost:5173").split(",").map((s) => s.trim()),
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  BACKUP_DIR: process.env.BACKUP_DIR || "./backups",
  REDIS_URL: process.env.REDIS_URL || "",

  // Resend (Email) Configuration
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  RESEND_FROM: process.env.RESEND_FROM || "Quick Send <noreply@quicksend.com.mx>",

  // Brevo (SMS/Email) Configuration
  BREVO_API_KEY: process.env.BREVO_API_KEY || "",
  BREVO_EMAIL_API_KEY: process.env.BREVO_EMAIL_API_KEY || "",
  BREVO_SMS_SENDER: process.env.BREVO_SMS_SENDER || "AuthOTP",
  BREVO_EMAIL_FROM: process.env.BREVO_EMAIL_FROM || "auth@quicksend.com",
  BREVO_EMAIL_NAME: process.env.BREVO_EMAIL_NAME || "Quick Send",

  // Crossmint Configuration
  CROSSMINT_API_KEY: process.env.CROSSMINT_API_KEY || "",
  CROSSMINT_BASE_URL: process.env.CROSSMINT_BASE_URL || "",

  TREASURY_SIGNER_SECRET: process.env.TREASURY_SIGNER_SECRET || "",
  TREASURY_RECOVERY_SECRET: process.env.TREASURY_RECOVERY_SECRET || "",
  WALLET_SIGNER_SECRET: process.env.WALLET_SIGNER_SECRET || "",
  WALLET_RECOVERY_SECRET: process.env.WALLET_RECOVERY_SECRET || "",

  // User Wallet Defaults
  USER_WALLET_CHAIN: process.env.USER_WALLET_CHAIN || "base",

  // Supported Networks (display names, index-matched with NETWORK_CHAIN)
  SUPPORTED_NETWORKS: (process.env.SUPPORTED_NETWORKS || "BASE,ETHEREUM,SOLANA,POLYGON").split(","),
  // Crossmint chain identifiers (index-matched with SUPPORTED_NETWORKS)
  NETWORK_CHAIN: (process.env.NETWORK_CHAIN || "base-sepolia,ethereum-sepolia,solana,polygon-amoy").split(","),

  // Treasury Defaults
  TREASURY_CHAIN: process.env.TREASURY_CHAIN || "base",
  HOT_TARGET: parseFloat(process.env.HOT_TARGET || "50000"),
  HOT_THRESHOLD_MIN: parseFloat(process.env.HOT_THRESHOLD_MIN || "20000"),
  HOT_REFILL_AMOUNT: parseFloat(process.env.HOT_REFILL_AMOUNT || "100000"),
  WARM_TARGET: parseFloat(process.env.WARM_TARGET || "500000"),
  WARM_THRESHOLD_MIN: parseFloat(process.env.WARM_THRESHOLD_MIN || "250000"),
  WARM_REFILL_AMOUNT: parseFloat(process.env.WARM_REFILL_AMOUNT || "1000000"),
  REFILL_INTERVAL: parseInt(process.env.REFILL_INTERVAL || "60000", 10),
};
