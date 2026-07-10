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
  EMAIL_FROM: process.env.EMAIL_FROM || "Quick Send <noreply@quicksend.com.mx>",
  ADMIN_APP_URL: process.env.ADMIN_APP_URL || "http://localhost:5173",

  // Twilio (SMS) Configuration
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || "",
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || "",
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || "",

  // AllRatesToday (FX) Configuration
  ART_API_KEY: process.env.ART_API_KEY || "art_live_hpJAZBmeQWsgqr6zg2u0X7tQEnGWMTxS",

  // Crossmint Configuration
  CROSSMINT_API_KEY: process.env.CROSSMINT_API_KEY || "",
  CROSSMINT_BASE_URL: process.env.CROSSMINT_BASE_URL || "",
  CROSSMINT_WEBHOOK_SECRET: process.env.CROSSMINT_WEBHOOK_SECRET || "",
  DEPOSIT_SIGNER_SECRET: process.env.DEPOSIT_SIGNER_SECRET || "",
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

  // Treasury Onramp / Offramp
  CROSSMINT_OFFRAMP_PAYMENT_METHOD_ID: process.env.CROSSMINT_OFFRAMP_PAYMENT_METHOD_ID || "",

  // Treasury Defaults
  TREASURY_CHAIN: process.env.TREASURY_CHAIN || "base",
  HOT_TARGET: parseFloat(process.env.HOT_TARGET || "50000"),
  HOT_THRESHOLD_MIN: parseFloat(process.env.HOT_THRESHOLD_MIN || "20000"),
  HOT_REFILL_AMOUNT: parseFloat(process.env.HOT_REFILL_AMOUNT || "100000"),
  WARM_TARGET: parseFloat(process.env.WARM_TARGET || "500000"),
  WARM_THRESHOLD_MIN: parseFloat(process.env.WARM_THRESHOLD_MIN || "250000"),
  WARM_REFILL_AMOUNT: parseFloat(process.env.WARM_REFILL_AMOUNT || "1000000"),
  REFILL_INTERVAL: parseInt(process.env.REFILL_INTERVAL || "60000", 10),

  // Didit Configuration
  DIDIT_API_KEY: process.env.DIDIT_API_KEY || "",
  DIDIT_API_BASE_URL: process.env.DIDIT_API_BASE_URL || "https://verification.didit.me",
};
