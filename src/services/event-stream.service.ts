import { broadcastToAdmins, broadcastToAll, getAdminCount, getConnectedUserCount } from "../websocket/ws.handler";
import { eventStore } from "../modules/events/event-store.service";
import { logger } from "../utils/logger";

class EventStreamService {
  streamToAdmin(eventType: string, data: Record<string, unknown>) {
    broadcastToAdmins({
      type: "ADMIN_EVENT",
      eventType,
      payload: data,
      timestamp: new Date().toISOString(),
    });
  }

  streamLiveTransaction(transaction: Record<string, unknown>) {
    broadcastToAdmins({
      type: "LIVE_TRANSACTION",
      payload: {
        id: transaction.id,
        userId: transaction.userId,
        amount: transaction.amount,
        status: transaction.status,
        payoutMethod: transaction.payoutMethod,
        referenceId: transaction.referenceId,
      },
      timestamp: new Date().toISOString(),
    });
  }

  streamPayoutUpdate(payout: Record<string, unknown>) {
    broadcastToAdmins({
      type: "PAYOUT_UPDATE",
      payload: {
        id: payout.id,
        transferId: payout.transferId,
        status: payout.status,
        partner: payout.partner,
        externalReference: payout.externalReference,
      },
      timestamp: new Date().toISOString(),
    });
  }

  streamKpiUpdate(kpis: Record<string, number>) {
    broadcastToAdmins({
      type: "KPI_UPDATE",
      payload: kpis,
      timestamp: new Date().toISOString(),
    });
  }

  streamAlert(severity: string, message: string) {
    broadcastToAdmins({
      type: "ALERT",
      payload: { severity, message },
      timestamp: new Date().toISOString(),
    });
  }

  async broadcastSystemStatus() {
    try {
      const eventCount = await eventStore.countEvents();
      const adminCount = getAdminCount();
      const userCount = getConnectedUserCount();

      broadcastToAdmins({
        type: "SYSTEM_STATUS",
        payload: {
          eventCount,
          connectedAdmins: adminCount,
          connectedUsers: userCount,
          uptime: process.uptime(),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error("[EVENT_STREAM] Failed to broadcast system status", err);
    }
  }
}

export const eventStreamService = new EventStreamService();
