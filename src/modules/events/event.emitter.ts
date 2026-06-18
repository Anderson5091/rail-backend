import { logger } from "../../utils/logger";
import type { EventPayload, EventType, EventHandler } from "./event.types";
import { eventStore } from "./event-store.service";
import { broadcastToAll } from "../../websocket/ws.handler";

class EventEmitter {
  private handlers: Map<EventType, EventHandler[]> = new Map();

  on(eventType: EventType, handler: EventHandler) {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  off(eventType: EventType, handler: EventHandler) {
    const existing = this.handlers.get(eventType) || [];
    this.handlers.set(
      eventType,
      existing.filter((h) => h !== handler)
    );
  }

  async emit(eventType: EventType, payload: EventPayload) {
    logger.info(`[EVENT] Emitting: ${eventType}`, { entity: payload.entity, entityId: payload.entityId });

    const aggregateId = `${payload.entity}:${payload.entityId}`;

    try {
      await eventStore.appendEvent(aggregateId, eventType, payload.metadata || {});
    } catch (err) {
      logger.error(`[EVENT] Failed to persist event ${eventType}`, err);
    }

    const dbEventLog = (await import("../../config/database")).prisma as any;
    await dbEventLog.eventLog.create({
      data: {
        eventType,
        entity: payload.entity,
        entityId: payload.entityId,
        payload: payload.metadata || {},
      },
    }).catch((err: Error) => logger.error("[EVENT] Failed to write event log", err));

    broadcastToAll({
      type: "EVENT",
      eventType,
      payload: {
        entity: payload.entity,
        entityId: payload.entityId,
        userId: payload.userId,
        metadata: payload.metadata,
      },
      timestamp: new Date().toISOString(),
    });

    const handlers = this.handlers.get(eventType) || [];
    await Promise.allSettled(handlers.map((handler) => handler(payload)));
  }
}

export const eventEmitter = new EventEmitter();
