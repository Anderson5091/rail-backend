import { z } from "zod";
import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/database";
import { generateToken } from "../../utils/token";
import { AppError } from "../../middleware/errorHandler";
import { authenticate, AuthRequest, requireRole } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimiter";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", authLimiter, async (req: AuthRequest, res: Response) => {
  const data = loginSchema.parse(req.body);

  const admin = await prisma.adminUser.findUnique({ where: { email: data.email } });
  if (admin) {
    if (admin.status !== "ACTIVE") throw new AppError(403, "Account is inactive");

    const valid = await bcrypt.compare(data.password, admin.passwordHash);
    if (!valid) throw new AppError(401, "Invalid credentials");

    const token = generateToken(admin.id, admin.role);
    const refreshToken = generateToken(admin.id, admin.role);

    return res.json({
      user: { id: admin.id, email: admin.email, role: admin.role, status: admin.status, createdAt: admin.createdAt },
      token,
      refreshToken,
    });
  }

  const agent = await prisma.agent.findUnique({ where: { email: data.email } });
  if (!agent) throw new AppError(401, "Invalid credentials");
  if (agent.status !== "ACTIVE") throw new AppError(403, "Account is inactive");

  const valid = await bcrypt.compare(data.password, agent.passwordHash);
  if (!valid) throw new AppError(401, "Invalid credentials");

  const agentRole = agent.type === "PARTNER" ? "AGENT_PARTNER" : "AGENT_INTERNAL";
  const token = generateToken(agent.id, agentRole);
  const refreshToken = generateToken(agent.id, agentRole);

  res.json({
    user: { id: agent.id, email: agent.email, role: agentRole, status: agent.status, createdAt: agent.createdAt },
    token,
    refreshToken,
  });
});

router.get("/me", authenticate, async (req: AuthRequest, res: Response) => {
  const admin = await prisma.adminUser.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, role: true, status: true, createdAt: true },
  });
  if (admin) {
    if (admin.status !== "ACTIVE") throw new AppError(403, "Account is inactive");
    return res.json(admin);
  }

  const agent = await prisma.agent.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, type: true, status: true, fullName: true, kpiRating: true, totalRewards: true, commissionLedger: true, createdAt: true },
  });
  if (!agent) throw new AppError(404, "Account not found");
  if (agent.status !== "ACTIVE") throw new AppError(403, "Account is inactive");

  const agentRole = agent.type === "PARTNER" ? "AGENT_PARTNER" : "AGENT_INTERNAL";
  res.json({
    id: agent.id,
    email: agent.email,
    role: agentRole,
    status: agent.status,
    createdAt: agent.createdAt,
  });
});

router.post("/register", authenticate, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
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
