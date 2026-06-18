import { Router, Response } from "express";
import { authenticate, AuthRequest, requireRole } from "../../middleware/auth";
import { healthController } from "./health/health.controller";
import { metricsService } from "./observability/metrics.service";
import { tracingService } from "./observability/tracing.service";
import { disasterRecoveryService } from "./disaster-recovery/disaster-recovery.service";
import { backupService } from "./disaster-recovery/backup.service";

const router = Router();

router.get("/health", async (req: AuthRequest, res: Response) => {
  await healthController.check(req, res);
});

router.get("/health/detailed", authenticate, async (req: AuthRequest, res: Response) => {
  await healthController.detailed(req, res);
});

router.get("/metrics", authenticate, requireRole("SUPER_ADMIN", "OPS"), async (_req: AuthRequest, res: Response) => {
  res.json(metricsService.getMetrics());
});

router.get("/traces", authenticate, requireRole("SUPER_ADMIN", "OPS"), async (_req: AuthRequest, res: Response) => {
  res.json(tracingService.getAllTraces());
});

router.post("/backup", authenticate, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res: Response) => {
  const result = await disasterRecoveryService.runBackup();
  res.json(result);
});

router.get("/backups", authenticate, requireRole("SUPER_ADMIN", "OPS"), async (_req: AuthRequest, res: Response) => {
  const backups = await backupService.listBackups();
  res.json({ backups });
});

router.post("/restore", authenticate, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  const { backupPath } = req.body;
  if (!backupPath) return res.status(400).json({ error: "backupPath required" });
  const result = await disasterRecoveryService.restoreFromBackup(backupPath);
  res.json(result);
});

router.get("/system-status", authenticate, requireRole("SUPER_ADMIN", "OPS"), async (_req: AuthRequest, res: Response) => {
  const status = await disasterRecoveryService.getSystemStatus();
  res.json(status);
});

export { router as productionRoutes };
