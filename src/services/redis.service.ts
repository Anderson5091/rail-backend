import Redis from "ioredis";
import { ENV } from "../config/env";
import { logger } from "../utils/logger";

class RedisService {
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private connected = false;

  get isConnected() {
    return this.connected;
  }

  getClient(): Redis {
    if (!this.client) throw new Error("Redis not initialized. Call redisService.connect() first.");
    return this.client;
  }

  getSubscriber(): Redis {
    if (!this.subscriber) throw new Error("Redis not initialized. Call redisService.connect() first.");
    return this.subscriber;
  }

  async connect() {
    if (this.connected) return;

    const url = ENV.REDIS_URL;
    if (!url) {
      logger.warn("[Redis] REDIS_URL not set — running without Redis (locks will use in-memory fallback)");
      return;
    }

    try {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          if (times > 5) return null;
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });

      this.subscriber = new Redis(url, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          if (times > 5) return null;
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });

      await Promise.all([this.client.connect(), this.subscriber.connect()]);
      this.connected = true;
      logger.info("[Redis] Connected successfully");
    } catch (error) {
      logger.error("[Redis] Connection failed — running without Redis", error);
      this.client = null;
      this.subscriber = null;
    }
  }

  async disconnect() {
    if (this.client) await this.client.quit();
    if (this.subscriber) await this.subscriber.quit();
    this.connected = false;
    logger.info("[Redis] Disconnected");
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const result = await this.client.ping();
      return result === "PONG";
    } catch {
      return false;
    }
  }
}

export const redisService = new RedisService();
