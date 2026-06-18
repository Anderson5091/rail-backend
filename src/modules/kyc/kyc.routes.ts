import { Router, Response } from "express";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest } from "../../middleware/auth";

const router = Router();

router.get("/status", authenticate, async (req: AuthRequest, res: Response) => {
  const profile = await prisma.kycProfile.findUnique({
    where: { userId: req.userId! },
  });

  const documents = await prisma.kycDocument.findMany({
    where: { userId: req.userId },
  });

  const riskScore = await prisma.riskScore.findUnique({
    where: { userId: req.userId! },
  });

  res.json({ profile, documents, riskScore });
});

router.post("/upload", authenticate, async (req: AuthRequest, res: Response) => {
  const { documentType } = req.body;

  const doc = await prisma.kycDocument.create({
    data: {
      userId: req.userId!,
      documentType,
      status: "PENDING",
    },
  });

  res.status(201).json(doc);
});

router.post("/upgrade-tier", authenticate, async (req: AuthRequest, res: Response) => {
  const profile = await prisma.kycProfile.findUnique({
    where: { userId: req.userId! },
  });

  if (!profile) {
    await prisma.kycProfile.create({
      data: { userId: req.userId!, tier: 2, status: "PENDING" },
    });
  } else {
    await prisma.kycProfile.update({
      where: { userId: req.userId! },
      data: { tier: profile.tier + 1, status: "PENDING" },
    });
  }

  res.json({ message: "Tier upgrade requested" });
});

export { router as kycRoutes };
