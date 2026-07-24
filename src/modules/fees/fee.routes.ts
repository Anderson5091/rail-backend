import { Router, Response } from "express";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest, requireRole } from "../../middleware/auth";
import { generateModelId } from "../../utils/id-generator";
const genId = (model: string) => generateModelId(model) ?? "";

const router = Router();

// --- FeeRule CRUD ---

router.get("/rules", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS"), async (_req: AuthRequest, res: Response) => {
  const rules = await prisma.feeRule.findMany({
    orderBy: [{ country: "asc" }, { payoutMethod: "asc" }],
  });
  res.json(rules.map((r: any) => ({
    id: r.id,
    country: r.country,
    payoutMethod: r.payoutMethod,
    fixedFee: Number(r.fixedFee),
    percentFee: Number(r.percentFee),
  })));
});

router.post("/rules", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS"), async (req: AuthRequest, res: Response) => {
  const { country, payoutMethod, fixedFee, percentFee } = req.body;
  if (!country || !payoutMethod) {
    return res.status(400).json({ error: "country and payoutMethod are required" });
  }
  const id = genId("FeeRule");
  const rule = await prisma.feeRule.create({
    data: { id, country, payoutMethod, fixedFee: fixedFee ?? 0, percentFee: percentFee ?? 0 },
  });

  await prisma.adminActionLog.create({
    data: {
      adminId: req.userId,
      action: "CREATE_FEE_RULE",
      entity: "FeeRule",
      entityId: rule.id,
      metadata: { country, payoutMethod },
    },
  });

  res.status(201).json({
    id: rule.id,
    country: rule.country,
    payoutMethod: rule.payoutMethod,
    fixedFee: Number(rule.fixedFee),
    percentFee: Number(rule.percentFee),
  });
});

router.put("/rules/:id", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS"), async (req: AuthRequest, res: Response) => {
  const existing = await prisma.feeRule.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Fee rule not found" });

  const data: Record<string, any> = {};
  if (req.body.country !== undefined) data.country = req.body.country;
  if (req.body.payoutMethod !== undefined) data.payoutMethod = req.body.payoutMethod;
  if (req.body.fixedFee !== undefined) data.fixedFee = req.body.fixedFee;
  if (req.body.percentFee !== undefined) data.percentFee = req.body.percentFee;

  const updated = await prisma.feeRule.update({ where: { id: req.params.id }, data });

  await prisma.adminActionLog.create({
    data: {
      adminId: req.userId,
      action: "UPDATE_FEE_RULE",
      entity: "FeeRule",
      entityId: updated.id,
      metadata: { changes: Object.keys(data) },
    },
  });

  res.json({
    id: updated.id,
    country: updated.country,
    payoutMethod: updated.payoutMethod,
    fixedFee: Number(updated.fixedFee),
    percentFee: Number(updated.percentFee),
  });
});

router.delete("/rules/:id", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "OPS"), async (req: AuthRequest, res: Response) => {
  const existing = await prisma.feeRule.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Fee rule not found" });

  await prisma.feeRule.delete({ where: { id: req.params.id } });

  await prisma.adminActionLog.create({
    data: {
      adminId: req.userId,
      action: "DELETE_FEE_RULE",
      entity: "FeeRule",
      entityId: req.params.id,
      metadata: { country: existing.country, payoutMethod: existing.payoutMethod },
    },
  });

  res.json({ success: true });
});

// --- FeeConfig CRUD ---

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
