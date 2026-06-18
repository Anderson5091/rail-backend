interface MetricCounter {
  count: number;
  lastUpdated: string;
}

interface MetricHistogram {
  values: number[];
  min: number;
  max: number;
  sum: number;
  count: number;
}

export class MetricsService {
  private counters: Record<string, MetricCounter> = {};
  private histograms: Record<string, MetricHistogram> = {};
  private startTime = Date.now();

  increment(metric: string, by = 1) {
    const existing = this.counters[metric] || { count: 0, lastUpdated: new Date().toISOString() };
    existing.count += by;
    existing.lastUpdated = new Date().toISOString();
    this.counters[metric] = existing;
  }

  recordLatency(metric: string, valueMs: number) {
    const existing = this.histograms[metric] || { values: [], min: valueMs, max: valueMs, sum: 0, count: 0 };
    existing.values.push(valueMs);
    existing.min = Math.min(existing.min, valueMs);
    existing.max = Math.max(existing.max, valueMs);
    existing.sum += valueMs;
    existing.count += 1;
    if (existing.values.length > 1000) existing.values = existing.values.slice(-500);
    this.histograms[metric] = existing;
  }

  getMetrics() {
    const counters = Object.entries(this.counters).map(([name, c]) => ({
      name,
      count: c.count,
      lastUpdated: c.lastUpdated,
    }));

    const latencies = Object.entries(this.histograms).map(([name, h]) => ({
      name,
      avg: h.count > 0 ? Math.round(h.sum / h.count) : 0,
      min: h.min,
      max: h.max,
      count: h.count,
    }));

    return {
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      counters,
      latencies,
      timestamp: new Date().toISOString(),
    };
  }

  getCounter(name: string) {
    return this.counters[name]?.count || 0;
  }
}

export const metricsService = new MetricsService();
