import { z } from "zod";
import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/database";
import { generateToken } from "../../utils/token";
import { AppError } from "../../middleware/errorHandler";
import { authenticate, AuthRequest } from "../../middleware/auth";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", async (req, res: Response) => {
  const data = loginSchema.parse(req.body);

  const agent = await prisma.agent.findUnique({
    where: { email: data.email },
    include: { wallets: true },
  });
  if (!agent) throw new AppError(401, "Invalid credentials");
  if (agent.status !== "ACTIVE") throw new AppError(403, "Agent account is inactive");

  const valid = await bcrypt.compare(data.password, agent.passwordHash);
  if (!valid) throw new AppError(401, "Invalid credentials");

  const token = generateToken(agent.id, agent.type === "PARTNER" ? "AGENT_PARTNER" : "AGENT_INTERNAL");

  res.json({
    user: { id: agent.id, email: agent.email, type: agent.type, fullName: agent.fullName },
    token,
    wallets: agent.wallets.map((w: { id: string; walletType: string; network: string; address: string; balance: { toString: () => string } }) => ({
      id: w.id,
      walletType: w.walletType,
      network: w.network,
      address: w.address,
      balance: Number(w.balance),
    })),
  });
});

router.get("/me", authenticate, async (req: AuthRequest, res: Response) => {
  const agent = await prisma.agent.findUnique({
    where: { id: req.userId },
    include: { wallets: true },
  });
  if (!agent) throw new AppError(404, "Agent not found");

  res.json({
    id: agent.id,
    email: agent.email,
    fullName: agent.fullName,
    phone: agent.phone,
    type: agent.type,
    status: agent.status,
    kpiRating: agent.kpiRating,
    totalRewards: Number(agent.totalRewards),
    wallets: agent.wallets.map((w: { id: string; walletType: string; network: string; address: string; balance: { toString: () => string } }) => ({
      id: w.id,
      walletType: w.walletType,
      network: w.network,
      address: w.address,
      balance: Number(w.balance),
    })),
  });
});

export { router as agentAuthRoutes };
