import { z } from "zod";
import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/database";
import { ENV } from "../../config/env";
import { generateToken, generateRefreshToken } from "../../utils/token";
import { AppError } from "../../middleware/errorHandler";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { crossmintService, type ChainType } from "../../services/crossmint.service";
import { ledgerService } from "../ledger/ledger.service";
import { otpService } from "./otp.service";
import { logger } from "../../utils/logger";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  phone: z.string().optional(),
  fullName: z.string().optional(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

async function createUserDepositWallets(userId: string) {
  const evmChain = ENV.NETWORK_CHAIN[ENV.SUPPORTED_NETWORKS.indexOf("BASE")] as ChainType;
  const solanaChain = ENV.NETWORK_CHAIN[ENV.SUPPORTED_NETWORKS.indexOf("SOLANA")] as ChainType;

  const walletConfigs = [
    { alias: "evm", chain: evmChain || ("base-sepolia" as ChainType) },
    { alias: "solana", chain: solanaChain || ("solana" as ChainType) },
  ];

  for (const cfg of walletConfigs) {
    try {
      const existing = await prisma.depositWallet.findUnique({
        where: { userId_alias: { userId, alias: cfg.alias } },
      });
      if (existing) continue;

      const wallet = await crossmintService.createWallet(cfg.chain, "DEPOSIT");

      await prisma.depositWallet.create({
        data: {
          userId,
          alias: cfg.alias,
          crossmintWalletId: wallet.crossmintWalletId,
          walletLocator: wallet.walletLocator,
          address: wallet.address,
          chain: cfg.chain,
        },
      });

      logger.info(`[Auth] Created ${cfg.alias} wallet for user ${userId}: ${wallet.address}`);
    } catch (error) {
      logger.warn(`[Auth] Failed to create ${cfg.alias} wallet for user ${userId}:`, error);
    }
  }
}

router.post("/register", async (req: Request, res: Response) => {
  const data = registerSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new AppError(409, "Email already registered");

  const password = await bcrypt.hash(data.password, 12);

  const { token } = await otpService.storeRegistration({
    email: data.email,
    phone: data.phone || "",
    fullName: data.fullName || "",
    password,
  });

  const phone = data.phone || "";
  const sentCode = await otpService.sendOtp(phone, data.email);
  await otpService.storeOtpCode(token, sentCode);

  const maskPhone = (p: string) => p.length > 4 ? p.slice(0, 3) + "****" + p.slice(-2) : p;

  res.status(201).json({
    token,
    phone: maskPhone(phone),
    message: "Verification code sent. Please verify to complete registration.",
  });
});

router.post("/send-otp", async (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) throw new AppError(400, "token required");

  const pending = await prisma.otpCode.findFirst({
    where: { token, type: "PHONE_VERIFICATION", verified: false, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!pending?.data || typeof pending.data !== "object" || !("phone" in pending.data) || !("email" in pending.data)) {
    throw new AppError(400, "No pending registration found for this token");
  }

  const { phone, email } = pending.data as any;
  const smsCode = await otpService.sendOtp(phone, email);
  await otpService.storeOtpCode(token, smsCode);

  res.json({ message: "OTP sent via SMS" });
});

router.post("/send-otp-email", async (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) throw new AppError(400, "token required");

  const pending = await prisma.otpCode.findFirst({
    where: { token, type: "PHONE_VERIFICATION", verified: false, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!pending?.data || typeof pending.data !== "object" || !("email" in pending.data)) {
    throw new AppError(400, "No pending registration found for this token");
  }

  const { email } = pending.data as any;
  const emailCode = await otpService.sendOtpEmailOnly(email);
  await otpService.storeOtpCode(token, emailCode);

  res.json({ message: "OTP sent via email" });
});

router.post("/verify-otp", async (req: Request, res: Response) => {
  const { token, code } = req.body;
  if (!token || !code) throw new AppError(400, "token and code required");

  const pendingData = await otpService.verifyOtp(token, code);
  if (!pendingData) throw new AppError(400, "Invalid or expired OTP");

  const existing = await prisma.user.findUnique({ where: { email: pendingData.email } });
  if (existing) throw new AppError(409, "Email already registered");

  const user = await prisma.user.create({
    data: {
      email: pendingData.email,
      phone: pendingData.phone,
      fullName: pendingData.fullName,
      password: pendingData.password,
      phoneVerified: true,
    },
  });

  const wallet = await prisma.wallet.create({
    data: { userId: user.id },
  });

  await ledgerService.credit(wallet.id, 2, `welcome_bonus_${user.id}`);

  await prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: "DEPOSIT",
      amount: 2,
      status: "COMPLETED",
    },
  });

  await createUserDepositWallets(user.id);

  const jwt = generateToken(user.id);
  const refreshToken = generateRefreshToken(user.id);

  res.json({
    user: { id: user.id, email: user.email, fullName: user.fullName, phoneVerified: true },
    token: jwt,
    refreshToken,
  });
});

router.post("/login", async (req: Request, res: Response) => {
  const data = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user) throw new AppError(401, "Invalid credentials");

  const valid = await bcrypt.compare(data.password, user.password);
  if (!valid) throw new AppError(401, "Invalid credentials");

  const jwt = generateToken(user.id);
  const refreshToken = generateRefreshToken(user.id);

  res.json({
    user: { id: user.id, email: user.email, fullName: user.fullName, phoneVerified: user.phoneVerified },
    token: jwt,
    refreshToken,
  });
});

router.post("/refresh", async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new AppError(400, "Refresh token required");

  try {
    const jwt = await import("jsonwebtoken");
    const decoded = jwt.default.verify(refreshToken, process.env.JWT_SECRET || "change-me") as { userId: string };
    const token = generateToken(decoded.userId);
    const newRefresh = generateRefreshToken(decoded.userId);
    res.json({ token, refreshToken: newRefresh });
  } catch {
    throw new AppError(401, "Invalid refresh token");
  }
});

router.post("/logout", (_req: Request, res: Response) => {
  res.json({ message: "Logged out" });
});

router.get("/me", authenticate, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, phone: true, fullName: true, createdAt: true },
  });
  if (!user) throw new AppError(404, "User not found");
  res.json(user);
});

export { router as authRoutes };
