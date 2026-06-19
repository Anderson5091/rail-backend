import { randomBytes } from "crypto";
import { redisService } from "./redis.service";
import { logger } from "../utils/logger";

interface LockEntry {
  holder: string;
  expiresAt: number;
}

class LockService {
  private locks: Map<string, LockEntry> = new Map();
  private readonly defaultTtlMs = 5000;
  private readonly retryDelayMs = 50;
  private readonly maxRetries = 100;

  private get redis() {
    try { return redisService.getClient(); } catch { return null; }
  }

  async acquire(resource: string, ttlMs = this.defaultTtlMs): Promise<string> {
    const lockId = randomBytes(16).toString("hex");
    const redis = this.redis;

    if (redis) {
      const ok = await redis.set(`lock:${resource}`, lockId, "PX", ttlMs, "NX");
      if (ok) {
        logger.debug("[LOCK] Acquired lock (Redis)", { resource, lockId, ttlMs });
        return lockId;
      }
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        const exists = await redis.get(`lock:${resource}`);
        if (!exists) {
          const acquired = await redis.set(`lock:${resource}`, lockId, "PX", ttlMs, "NX");
          if (acquired) {
            logger.debug("[LOCK] Acquired lock (Redis)", { resource, lockId, ttlMs });
            return lockId;
          }
        }
        await new Promise((r) => setTimeout(r, this.retryDelayMs));
      }
      throw new Error(`[LOCK] Could not acquire lock on ${resource} after ${this.maxRetries} retries (Redis)`);
    }

    const expireAt = Date.now() + ttlMs;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const existing = this.locks.get(resource);
      if (!existing || existing.expiresAt < Date.now()) {
        this.locks.set(resource, { holder: lockId, expiresAt: expireAt });
        logger.debug("[LOCK] Acquired lock (in-memory)", { resource, lockId, ttlMs });
        return lockId;
      }
      await new Promise((r) => setTimeout(r, this.retryDelayMs));
    }

    throw new Error(`[LOCK] Could not acquire lock on ${resource} after ${this.maxRetries} retries`);
  }

  async release(resource: string, lockId: string): Promise<void> {
    const redis = this.redis;
    if (redis) {
      const script = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
      await redis.eval(script, 1, `lock:${resource}`, lockId);
      logger.debug("[LOCK] Released lock (Redis)", { resource, lockId });
      return;
    }

    const entry = this.locks.get(resource);
    if (entry && entry.holder === lockId) {
      this.locks.delete(resource);
      logger.debug("[LOCK] Released lock (in-memory)", { resource, lockId });
    }
  }

  async withLock<T>(resource: string, fn: () => Promise<T>, ttlMs?: number): Promise<T> {
    const lockId = await this.acquire(resource, ttlMs);
    try {
      return await fn();
    } finally {
      await this.release(resource, lockId);
    }
  }

  async isLocked(resource: string): Promise<boolean> {
    const redis = this.redis;
    if (redis) {
      const val = await redis.get(`lock:${resource}`);
      return val !== null;
    }
    const entry = this.locks.get(resource);
    return !!entry && entry.expiresAt >= Date.now();
  }
}

export const lockService = new LockService();
