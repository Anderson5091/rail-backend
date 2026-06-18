import { z } from "zod";
import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/database";
import { generateToken } from "../../utils/token";
import { AppError } from "../../middleware/errorHandler";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimiter";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", authLimiter, async (req: AuthRequest, res: Response) => {
  const data = loginSchema.parse(req.body);

  const admin = await prisma.adminUser.findUnique({ where: { email: data.email } });
  if (!admin) throw new AppError(401, "Invalid credentials");

  if (admin.status !== "ACTIVE") throw new AppError(403, "Account is inactive");

  const valid = await bcrypt.compare(data.password, admin.passwordHash);
  if (!valid) throw new AppError(401, "Invalid credentials");

  const token = generateToken(admin.id, admin.role);
  const refreshToken = generateToken(admin.id, admin.role);

  res.json({
    user: { id: admin.id, email: admin.email, role: admin.role },
    token,
    refreshToken,
  });
});

router.get("/me", authenticate, async (req: AuthRequest, res: Response) => {
  const admin = await prisma.adminUser.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, role: true, status: true, createdAt: true },
  });
  if (!admin) throw new AppError(404, "Admin not found");
  if (admin.status !== "ACTIVE") throw new AppError(403, "Account is inactive");

  res.json(admin);
});

router.post("/register", authLimiter, async (req: AuthRequest, res: Response) => {
  const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(["SUPER_ADMIN", "COMPLIANCE", "OPS", "TREASURY"]).default("OPS"),
  });

  const data = registerSchema.parse(req.body);

  const existing = await prisma.adminUser.findUnique({ where: { email: data.email } });
  if (existing) throw new AppError(409, "Email already registered");

  const passwordHash = await bcrypt.hash(data.password, 12);
  const admin = await prisma.adminUser.create({
    data: { email: data.email, passwordHash, role: data.role },
  });

  res.status(201).json({
    user: { id: admin.id, email: admin.email, role: admin.role },
  });
});

export { router as adminAuthRoutes };
