import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { kycService } from "./kyc.service";
import { AppError } from "../../middleware/errorHandler";

const router = Router();

const tier1Schema = z.object({
  fullName: z.string().min(1).max(255),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format"),
  nationality: z.string().min(1).max(100),
  country: z.string().min(1).max(100),
  address: z.string().min(1),
});

const tier2Schema = z.object({
  idImage: z.string().min(1, "idImage (base64) required"),
  idImageBack: z.string().optional(),
  selfieImage: z.string().min(1, "selfieImage (base64) required"),
  documentType: z.enum(["PASSPORT", "NATIONAL_ID", "DRIVER_LICENSE"]),
});

const tier3Schema = z.object({
  poaImage: z.string().min(1, "poaImage (base64) required"),
  sourceOfFunds: z.string().optional(),
});

router.get("/status", authenticate, async (req: AuthRequest, res: Response) => {
  const result = await kycService.getStatus(req.userId!);
  res.json(result);
});

router.post("/tier-1", authenticate, async (req: AuthRequest, res: Response) => {
  const parsed = tier1Schema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, "Validation failed");

  const result = await kycService.processTier1(req.userId!, parsed.data);
  res.json(result);
});

router.post("/tier-2", authenticate, async (req: AuthRequest, res: Response) => {
  const parsed = tier2Schema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, "Validation failed");

  const result = await kycService.processTier2(req.userId!, parsed.data);
  res.json(result);
});

router.post("/tier-3", authenticate, async (req: AuthRequest, res: Response) => {
  const parsed = tier3Schema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, "Validation failed");

  const result = await kycService.processTier3(req.userId!, parsed.data);
  res.json(result);
});

export { router as kycRoutes };
