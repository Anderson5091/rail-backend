import { z } from "zod";
import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/database";
import { ENV } from "../../config/env";
import { generateToken, generateRefreshToken } from "../../utils/token";
import { AppError } from "../../middleware/errorHandler";
import { authLimiter } from "../../middleware/rateLimiter";
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

async function createUserCryptoWallets(userId: string) {
  const networks = ENV.SUPPORTED_NETWORKS;
  const chains = ENV.NETWORK_CHAIN;

  for (let i = 0; i < networks.length; i++) {
    const chain = chains[i] as ChainType;
    try {
      const wallet = await crossmintService.createWallet(chain, "DEPOSIT");

      await prisma.userCryptoWallet.create({
        data: {
          userId,
          network: networks[i],
          chain,
          crossmintWalletId: wallet.crossmintWalletId,
          walletLocator: wallet.walletLocator,
          address: wallet.address,
        },
      });

      logger.info(`[Auth] Created ${networks[i]} crypto wallet for user ${userId}: ${wallet.address}`);
    } catch (error) {
      logger.warn(`[Auth] Failed to create ${networks[i]} crypto wallet for user ${userId}:`, error);
    }
  }
}

router.post("/register", authLimiter, async (req: Request, res: Response) => {
  const data = registerSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new AppError(409, "Email already registered");

  const password = await bcrypt.hash(data.password, 12);

  const user = await prisma.user.create({
    data: { email: data.email, phone: data.phone, fullName: data.fullName, password },
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

  await createUserCryptoWallets(user.id);

  if (user.phone) {
    await otpService.sendOtp(user.id, user.phone, user.email ?? undefined);
  }

  const maskPhone = (p: string) => p.length > 4 ? p.slice(0, 3) + "****" + p.slice(-2) : p;

  res.status(201).json({
    userId: user.id,
    email: user.email,
    phone: user.phone ? maskPhone(user.phone) : null,
    message: "Account created. Please verify your phone number.",
  });
});

router.post("/send-otp", authLimiter, async (req: Request, res: Response) => {
  const { userId } = req.body;
  if (!userId) throw new AppError(400, "userId required");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, "User not found");
  if (!user.phone) throw new AppError(400, "No phone number on file");

  await otpService.sendOtp(user.id, user.phone, user.email ?? undefined);

  res.json({ message: "OTP sent via SMS" });
});

router.post("/send-otp-email", authLimiter, async (req: Request, res: Response) => {
  const { userId } = req.body;
  if (!userId) throw new AppError(400, "userId required");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, "User not found");
  if (!user.email) throw new AppError(400, "No email on file");

  await otpService.sendOtpEmailOnly(user.id, user.email);

  res.json({ message: "OTP sent via email" });
});

router.post("/verify-otp", authLimiter, async (req: Request, res: Response) => {
  const { userId, code } = req.body;
  if (!userId || !code) throw new AppError(400, "userId and code required");

  const valid = await otpService.verifyOtp(userId, code);
  if (!valid) throw new AppError(400, "Invalid or expired OTP");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, "User not found");

  const token = generateToken(user.id);
  const refreshToken = generateRefreshToken(user.id);

  res.json({
    user: { id: user.id, email: user.email, fullName: user.fullName, phoneVerified: user.phoneVerified },
    token,
    refreshToken,
  });
});

router.post("/login", authLimiter, async (req: Request, res: Response) => {
  const data = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user) throw new AppError(401, "Invalid credentials");

  const valid = await bcrypt.compare(data.password, user.password);
  if (!valid) throw new AppError(401, "Invalid credentials");

  if (!user.phoneVerified) {
    throw new AppError(403, "Phone number not verified. Please verify your phone first.");
  }

  const token = generateToken(user.id);
  const refreshToken = generateRefreshToken(user.id);

  res.json({
    user: { id: user.id, email: user.email, fullName: user.fullName, phoneVerified: user.phoneVerified },
    token,
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
