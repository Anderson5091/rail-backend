import { redisService } from "./redis.service";
import { logger } from "../utils/logger";

class CacheService {
  private memoryCache = new Map<string, { value: string; expiresAt: number }>();
  private readonly defaultTtlMs = 60_000;

  private get redis() {
    try { return redisService.getClient(); } catch { return null; }
  }

  async get<T>(key: string): Promise<T | null> {
    const redis = this.redis;
    if (redis) {
      const raw = await redis.get(`cache:${key}`);
      if (raw != null) {
        try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
      }
      return null;
    }
    const entry = this.memoryCache.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      if (entry) this.memoryCache.delete(key);
      return null;
    }
    try { return JSON.parse(entry.value) as T; } catch { return entry.value as unknown as T; }
  }

  async set(key: string, value: unknown, ttlMs = this.defaultTtlMs): Promise<void> {
    const redis = this.redis;
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (redis) {
      await redis.set(`cache:${key}`, serialized, "PX", ttlMs);
      return;
    }
    this.memoryCache.set(key, { value: serialized, expiresAt: Date.now() + ttlMs });
  }

  async del(key: string): Promise<void> {
    const redis = this.redis;
    if (redis) {
      await redis.del(`cache:${key}`);
      return;
    }
    this.memoryCache.delete(key);
  }

  async clearPrefix(prefix: string): Promise<void> {
    const redis = this.redis;
    if (redis) {
      const keys = await redis.keys(`cache:${prefix}*`);
      if (keys.length > 0) await redis.del(...keys);
      return;
    }
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(prefix)) this.memoryCache.delete(key);
    }
  }
}

export const cacheService = new CacheService();
