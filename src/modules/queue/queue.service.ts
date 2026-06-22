import { prisma } from "../../config/database";
import { PayoutOrchestrator } from "../payout/payout.orchestrator";
import { logger } from "../../utils/logger";

const payoutOrchestrator = new PayoutOrchestrator();

export class QueueService {
  async publish(queue: string, message: any) {
    console.log(`[Queue] Published to ${queue}:`, JSON.stringify(message));
  }

  async processPayouts() {
    const pending = await prisma.payoutOrder.findMany({
      where: { status: "PENDING" },
      include: { transfer: true },
    });

    for (const order of pending) {
      try {
        await payoutOrchestrator.execute(order.transfer);
      } catch (err: any) {
        logger.error(`[QUEUE] Failed to process payout ${order.id}: ${err.message}`);
      }
    }
  }
}

export const queueService = new QueueService();
