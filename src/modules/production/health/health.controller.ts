import { Request, Response } from "express";
import { prisma } from "../../../config/database";
import { metricsService } from "../observability/metrics.service";

const db = prisma as any;

interface HealthCheckResult {
  status: string;
  version: string;
  uptime: number;
  timestamp: string;
  services: Record<string, string>;
  metrics: {
    totalRequests: number;
    activeTraces: number;
  };
}

export class HealthController {
  async check(_req: Request, res: Response) {
    const services: Record<string, string> = {
      api: "UP",
    };

    try {
      await db.$queryRaw`SELECT 1`;
      services.database = "UP";
    } catch {
      services.database = "DOWN";
    }

    const result: HealthCheckResult = {
      status: services.database === "DOWN" ? "DEGRADED" : "OK",
      version: "1.0.0",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services,
      metrics: {
        totalRequests: metricsService.getCounter("api_requests_total"),
        activeTraces: 0,
      },
    };

    const statusCode = services.database === "DOWN" ? 503 : 200;
    res.status(statusCode).json(result);
  }

  async detailed(_req: Request, res: Response) {
    try {
      await db.$queryRaw`SELECT 1`;
    } catch {
      return res.status(503).json({ status: "DEGRADED", services: { database: "DOWN" } });
    }

    const dbStats = await db.$queryRaw`
      SELECT
        (SELECT COUNT(*) FROM "User") as users,
        (SELECT COUNT(*) FROM "Transfer") as transfers,
        (SELECT COUNT(*) FROM "PayoutOrder") as payouts
    `;

    res.json({
      status: "OK",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: dbStats,
      metrics: metricsService.getMetrics(),
    });
  }
}

export const healthController = new HealthController();
