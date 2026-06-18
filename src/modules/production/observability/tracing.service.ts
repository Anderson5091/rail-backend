import { loggerService } from "./logger.service";

interface TraceSpan {
  id: string;
  parentId?: string;
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: "started" | "completed" | "failed";
  error?: string;
}

export class TracingService {
  private traces: Map<string, TraceSpan> = new Map();
  private activeTraces: Map<string, string> = new Map();

  startTrace(id: string, operation: string, parentId?: string) {
    const span: TraceSpan = {
      id,
      operation,
      startTime: Date.now(),
      status: "started",
      parentId,
    };
    this.traces.set(id, span);
    this.activeTraces.set(id, id);
    loggerService.debug(`[TRACE] Start: ${operation}`, { traceId: id, parentId });
  }

  endTrace(id: string) {
    const span = this.traces.get(id);
    if (!span) return;

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = "completed";
    this.activeTraces.delete(id);
    loggerService.debug(`[TRACE] End: ${span.operation}`, { traceId: id, duration: span.duration });
  }

  failTrace(id: string, error: string) {
    const span = this.traces.get(id);
    if (!span) return;

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = "failed";
    span.error = error;
    this.activeTraces.delete(id);
    loggerService.warn(`[TRACE] Failed: ${span.operation}`, { traceId: id, duration: span.duration, error });
  }

  getTrace(id: string) {
    return this.traces.get(id);
  }

  getActiveTraces() {
    return Array.from(this.activeTraces.keys()).map((id) => this.traces.get(id)).filter(Boolean);
  }

  getAllTraces() {
    return Array.from(this.traces.values());
  }
}

export const tracingService = new TracingService();
