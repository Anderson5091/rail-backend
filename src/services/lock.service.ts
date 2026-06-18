import { randomBytes } from "crypto";
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

  async acquire(resource: string, ttlMs = this.defaultTtlMs): Promise<string> {
    const lockId = randomBytes(16).toString("hex");
    const expireAt = Date.now() + ttlMs;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const existing = this.locks.get(resource);
      if (!existing || existing.expiresAt < Date.now()) {
        this.locks.set(resource, { holder: lockId, expiresAt: expireAt });
        logger.debug(`[LOCK] Acquired lock on ${resource}`, { lockId, ttlMs });
        return lockId;
      }
      await new Promise((r) => setTimeout(r, this.retryDelayMs));
    }

    throw new Error(`[LOCK] Could not acquire lock on ${resource} after ${this.maxRetries} retries`);
  }

  release(resource: string, lockId: string): void {
    const entry = this.locks.get(resource);
    if (entry && entry.holder === lockId) {
      this.locks.delete(resource);
      logger.debug(`[LOCK] Released lock on ${resource}`, { lockId });
    }
  }

  async withLock<T>(resource: string, fn: () => Promise<T>, ttlMs?: number): Promise<T> {
    const lockId = await this.acquire(resource, ttlMs);
    try {
      return await fn();
    } finally {
      this.release(resource, lockId);
    }
  }

  isLocked(resource: string): boolean {
    const entry = this.locks.get(resource);
    return !!entry && entry.expiresAt >= Date.now();
  }
}

export const lockService = new LockService();
