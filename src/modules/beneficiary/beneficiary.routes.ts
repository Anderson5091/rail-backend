import { z } from "zod";
import { Router, Response } from "express";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest } from "../../middleware/auth";

const router = Router();

const createSchema = z.object({
  fullName: z.string().min(1),
  country: z.string().min(1),
  payoutMethod: z.enum(["BANK", "MOBILE_MONEY", "CASH_PICKUP"]),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  mobileWalletNumber: z.string().optional(),
  mobileProvider: z.string().optional(),
  cashPickupLocation: z.string().optional(),
});

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  const beneficiaries = await prisma.beneficiary.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
  });
  res.json(beneficiaries);
});

router.post("/", authenticate, async (req: AuthRequest, res: Response) => {
  const data = createSchema.parse(req.body);
  const beneficiary = await prisma.beneficiary.create({
    data: { ...data, userId: req.userId! },
  });
  res.status(201).json(beneficiary);
});

router.put("/:id", authenticate, async (req: AuthRequest, res: Response) => {
  const data = createSchema.partial().parse(req.body);
  const beneficiary = await prisma.beneficiary.updateMany({
    where: { id: req.params.id, userId: req.userId },
    data,
  });
  res.json(beneficiary);
});

router.delete("/:id", authenticate, async (req: AuthRequest, res: Response) => {
  await prisma.beneficiary.deleteMany({
    where: { id: req.params.id, userId: req.userId },
  });
  res.json({ message: "Deleted" });
});

export { router as beneficiaryRoutes };
