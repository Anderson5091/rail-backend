import { prisma } from "../../config/database";
import { logger } from "../../utils/logger";

interface StoredEvent {
  id: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown> | null;
  version: number;
  createdAt: Date;
}

class EventStore {
  async appendEvent(
    aggregateId: string,
    type: string,
    payload: Record<string, unknown>,
    expectedVersion?: number
  ): Promise<StoredEvent> {
    const db = prisma as any;

    let version: number;
    if (expectedVersion !== undefined) {
      version = expectedVersion + 1;
      try {
        const event = await db.event.create({
          data: { aggregateId, type, payload, version },
        });
        logger.debug(`[EVENT_STORE] Appended event ${type} v${version} for ${aggregateId}`);
        return event;
      } catch (err: any) {
        if (err.code === "P2002") {
          throw new Error(
            `[EVENT_STORE] Concurrency conflict on ${aggregateId}: version ${version} already exists`
          );
        }
        throw err;
      }
    }

    const lastEvent = await db.event.findFirst({
      where: { aggregateId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    version = (lastEvent?.version ?? 0) + 1;

    const event = await db.event.create({
      data: { aggregateId, type, payload, version },
    });
    logger.debug(`[EVENT_STORE] Appended event ${type} v${version} for ${aggregateId}`);
    return event;
  }

  async getEvents(aggregateId: string): Promise<StoredEvent[]> {
    const db = prisma as any;
    return db.event.findMany({
      where: { aggregateId },
      orderBy: { version: "asc" },
    });
  }

  async getEventsByType(type: string, since?: Date): Promise<StoredEvent[]> {
    const db = prisma as any;
    return db.event.findMany({
      where: {
        type,
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async getAllEvents(limit = 500): Promise<StoredEvent[]> {
    const db = prisma as any;
    return db.event.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async getCurrentVersion(aggregateId: string): Promise<number> {
    const db = prisma as any;
    const last = await db.event.findFirst({
      where: { aggregateId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return last?.version ?? 0;
  }

  async countEvents(): Promise<number> {
    const db = prisma as any;
    return db.event.count();
  }

  async deleteAll(): Promise<void> {
    const db = prisma as any;
    await db.event.deleteMany();
    logger.warn("[EVENT_STORE] All events deleted — replay will be empty");
  }
}

type AggregateState = Record<string, unknown>;

type ReducerFn<T extends AggregateState = AggregateState> = (
  state: T,
  event: StoredEvent
) => T;

function replayFrom<T extends AggregateState = AggregateState>(
  events: StoredEvent[],
  reducer: ReducerFn<T>,
  initialState: T
): T {
  return events.reduce(reducer, initialState);
}

export { replayFrom };
export type { StoredEvent, AggregateState, ReducerFn };
export const eventStore = new EventStore();
