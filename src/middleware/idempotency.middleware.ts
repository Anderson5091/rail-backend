import { Response, NextFunction } from "express";
import { createHash } from "crypto";
import { prisma } from "../config/database";
import { AuthRequest } from "./auth";
import { logger } from "../utils/logger";

const IDEMPOTENCY_HEADER = "Idempotency-Key";

export function idempotencyMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const key = req.headers[IDEMPOTENCY_HEADER.toLowerCase()] as string | undefined;
  if (!key) {
    next();
    return;
  }

  if (typeof key !== "string" || key.length < 8 || key.length > 128) {
    res.status(400).json({ error: "Idempotency-Key must be 8-128 characters" });
    return;
  }

  const requestHash = createHash("sha256")
    .update(JSON.stringify({ body: req.body, url: req.originalUrl, userId: req.userId }))
    .digest("hex");

  (async () => {
    const existing = await (prisma as any).idempotencyKey.findUnique({ where: { key } });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        res.status(422).json({ error: "Idempotency key already used with different request parameters" });
        return;
      }
      logger.info(`[IDEMPOTENCY] Reusing cached response for key ${key}`);
      res.status(200).json(existing.response);
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      (prisma as any).idempotencyKey
        .create({
          data: {
            key,
            userId: req.userId,
            status: "COMPLETED",
            response: body as any,
            requestHash,
          },
        })
        .catch((err: Error) => logger.error("[IDEMPOTENCY] Failed to persist key", err));

      return originalJson(body);
    };

    next();
  })();
}
