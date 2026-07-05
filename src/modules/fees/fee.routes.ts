import { Router, Response } from "express";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest, requireRole } from "../../middleware/auth";

const router = Router();

router.get("/", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS"), async (_req: AuthRequest, res: Response) => {
  const configs = await prisma.feeConfig.findMany({
    orderBy: { createdAt: "asc" },
  });
  res.json(configs.map((c: any) => ({
    id: c.id,
    transactionType: c.transactionType,
    label: c.label,
    description: c.description,
    systemFeeEnabled: c.systemFeeEnabled,
    systemFeeMode: c.systemFeeMode,
    systemFixedFee: Number(c.systemFixedFee),
    systemPercentFee: Number(c.systemPercentFee),
    processingFeeEnabled: c.processingFeeEnabled,
    processingFeeMode: c.processingFeeMode,
    processingFixedFee: Number(c.processingFixedFee),
    processingPercentFee: Number(c.processingPercentFee),
    superAdminOnly: c.superAdminOnly,
    enabled: c.enabled,
    updatedBy: c.updatedBy,
    updatedAt: c.updatedAt,
    createdAt: c.createdAt,
  })));
});

router.get("/:id", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS"), async (req: AuthRequest, res: Response) => {
  const config = await prisma.feeConfig.findUnique({ where: { id: req.params.id } });
  if (!config) return res.status(404).json({ error: "Fee config not found" });
  res.json({
    id: config.id,
    transactionType: config.transactionType,
    label: config.label,
    description: config.description,
    systemFeeEnabled: config.systemFeeEnabled,
    systemFeeMode: config.systemFeeMode,
    systemFixedFee: Number(config.systemFixedFee),
    systemPercentFee: Number(config.systemPercentFee),
    processingFeeEnabled: config.processingFeeEnabled,
    processingFeeMode: config.processingFeeMode,
    processingFixedFee: Number(config.processingFixedFee),
    processingPercentFee: Number(config.processingPercentFee),
    superAdminOnly: config.superAdminOnly,
    enabled: config.enabled,
    updatedBy: config.updatedBy,
    updatedAt: config.updatedAt,
    createdAt: config.createdAt,
  });
});

router.put("/:id", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS"), async (req: AuthRequest, res: Response) => {
  const config = await prisma.feeConfig.findUnique({ where: { id: req.params.id } });
  if (!config) return res.status(404).json({ error: "Fee config not found" });

  if (config.superAdminOnly && req.userRole !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Only SUPER_ADMIN can modify this fee config" });
  }

  const data: Record<string, any> = {};

  if (req.body.systemFeeEnabled !== undefined) data.systemFeeEnabled = req.body.systemFeeEnabled;
  if (req.body.systemFeeMode !== undefined) data.systemFeeMode = req.body.systemFeeMode;
  if (req.body.systemFixedFee !== undefined) data.systemFixedFee = req.body.systemFixedFee;
  if (req.body.systemPercentFee !== undefined) data.systemPercentFee = req.body.systemPercentFee;
  if (req.body.processingFeeEnabled !== undefined) data.processingFeeEnabled = req.body.processingFeeEnabled;
  if (req.body.processingFeeMode !== undefined) data.processingFeeMode = req.body.processingFeeMode;
  if (req.body.processingFixedFee !== undefined) data.processingFixedFee = req.body.processingFixedFee;
  if (req.body.processingPercentFee !== undefined) data.processingPercentFee = req.body.processingPercentFee;
  if (req.body.enabled !== undefined) data.enabled = req.body.enabled;
  data.updatedBy = req.userId;

  const updated = await prisma.feeConfig.update({
    where: { id: req.params.id },
    data,
  });

  await prisma.adminActionLog.create({
    data: {
      adminId: req.userId,
      action: "UPDATE_FEE_CONFIG",
      entity: "FeeConfig",
      entityId: updated.id,
      metadata: { transactionType: updated.transactionType, changes: Object.keys(data) },
    },
  });

  res.json({
    id: updated.id,
    transactionType: updated.transactionType,
    label: updated.label,
    description: updated.description,
    systemFeeEnabled: updated.systemFeeEnabled,
    systemFeeMode: updated.systemFeeMode,
    systemFixedFee: Number(updated.systemFixedFee),
    systemPercentFee: Number(updated.systemPercentFee),
    processingFeeEnabled: updated.processingFeeEnabled,
    processingFeeMode: updated.processingFeeMode,
    processingFixedFee: Number(updated.processingFixedFee),
    processingPercentFee: Number(updated.processingPercentFee),
    superAdminOnly: updated.superAdminOnly,
    enabled: updated.enabled,
    updatedBy: updated.updatedBy,
    updatedAt: updated.updatedAt,
    createdAt: updated.createdAt,
  });
});

export { router as feeRoutes };
