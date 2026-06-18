import { prisma } from "../../config/database";
import { eventStore, replayFrom } from "./event-store.service";
import type { AggregateState, ReducerFn } from "./event-store.service";
import { logger } from "../../utils/logger";

interface WalletBalanceState extends AggregateState {
  balance: number;
  lastEventVersion: number;
}

const walletReducer: ReducerFn<WalletBalanceState> = (state, event) => {
  const payload = event.payload || {};

  switch (event.type) {
    case "WALLET_CREDITED":
      return { ...state, balance: state.balance + Number(payload.amount || 0), lastEventVersion: event.version };
    case "WALLET_DEBITED":
      return { ...state, balance: state.balance - Number(payload.amount || 0), lastEventVersion: event.version };
    case "TRANSFER_CREATED":
    case "TRANSFER_COMPLETED":
    case "TRANSFER_FAILED":
      return { ...state, lastEventVersion: event.version };
    default:
      return state;
  }
};

interface TransferState extends AggregateState {
  status: string;
  amount: number;
  payoutMethod: string;
  lastEventVersion: number;
}

const transferReducer: ReducerFn<TransferState> = (state, event) => {
  const payload = event.payload || {};

  switch (event.type) {
    case "TRANSFER_CREATED":
      return { ...state, status: "PENDING_PAYOUT", amount: Number(payload.amount || 0), payoutMethod: String(payload.payoutMethod || ""), lastEventVersion: event.version };
    case "TRANSFER_COMPLETED":
      return { ...state, status: "COMPLETED", lastEventVersion: event.version };
    case "TRANSFER_FAILED":
      return { ...state, status: "FAILED", lastEventVersion: event.version };
    case "PAYOUT_SENT":
      return { ...state, status: "SENT_TO_PARTNER", lastEventVersion: event.version };
    case "PAYOUT_CONFIRMED":
      return { ...state, status: "CONFIRMED", lastEventVersion: event.version };
    case "PAYOUT_FAILED":
      return { ...state, status: "PAYOUT_FAILED", lastEventVersion: event.version };
    default:
      return state;
  }
};

class EventReplayService {
  rebuildWalletBalance(walletId: string): Promise<WalletBalanceState> {
    return this.rebuildAggregate<WalletBalanceState>(walletId, walletReducer, { balance: 0, lastEventVersion: 0 });
  }

  rebuildTransferState(transferId: string): Promise<TransferState> {
    return this.rebuildAggregate<TransferState>(transferId, transferReducer, { status: "DRAFT", amount: 0, payoutMethod: "", lastEventVersion: 0 });
  }

  async rebuildAggregate<T extends AggregateState>(
    aggregateId: string,
    reducer: ReducerFn<T>,
    initialState: T
  ): Promise<T> {
    const events = await eventStore.getEvents(aggregateId);
    if (events.length === 0) {
      throw new Error(`[REPLAY] No events found for aggregate ${aggregateId}`);
    }
    return replayFrom(events, reducer, initialState);
  }

  async rebuildFromScratch<T extends AggregateState>(
    reducer: ReducerFn<T>,
    initialState: T,
    eventTypeFilter?: string
  ): Promise<Map<string, T>> {
    const db = prisma as any;
    const where = eventTypeFilter ? { type: eventTypeFilter } : {};
    const allEvents = await db.event.findMany({
      where,
      orderBy: [{ aggregateId: "asc" }, { version: "asc" }],
    });

    const snapshots = new Map<string, T>();
    for (const event of allEvents) {
      const current = snapshots.get(event.aggregateId) || { ...initialState };
      snapshots.set(event.aggregateId, reducer(current, event));
    }
    logger.info(`[REPLAY] Rebuilt ${snapshots.size} aggregates from ${allEvents.length} events`);
    return snapshots;
  }

  async verifyConsistency(): Promise<{ consistent: boolean; mismatches: string[] }> {
    const wallets = await prisma.wallet.findMany({ include: { ledgerEntries: true } });
    const mismatches: string[] = [];

    for (const wallet of wallets) {
      try {
        const replayed = await this.rebuildWalletBalance(wallet.id);
        const computedBalance = wallet.ledgerEntries.reduce(
          (sum: number, e: { type: string; amount: { toString: () => string } }) =>
            e.type === "CREDIT" ? sum + Number(e.amount) : sum - Number(e.amount),
          0
        );
        if (Math.abs(replayed.balance - computedBalance) > 0.001) {
          mismatches.push(`Wallet ${wallet.id}: events say ${replayed.balance}, ledger says ${computedBalance}`);
        }
      } catch {
        mismatches.push(`Wallet ${wallet.id}: no events found`);
      }
    }

    return { consistent: mismatches.length === 0, mismatches };
  }
}

export const eventReplayService = new EventReplayService();
