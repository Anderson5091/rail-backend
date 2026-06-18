import { partnerRepository } from "../registry/partner.repository";
import { logger } from "../../../utils/logger";

export class SlaMonitorService {
  async recordSuccess(partnerId: string, responseTimeMs: number) {
    const metric = await partnerRepository.getOrCreateSlaMetric(partnerId);
    const totalAttempts = metric.successRate !== null && metric.failureCount !== null
      ? Math.round((metric.successRate * (metric.failureCount + 1)) / (100 - metric.successRate + 0.001)) + metric.failureCount + 1
      : 1;
    const successes = totalAttempts - (metric.failureCount || 0);
    const newRate = Math.round(((successes) / totalAttempts) * 100);
    const newAvg = metric.avgResponseTimeMs
      ? Math.round((metric.avgResponseTimeMs + responseTimeMs) / 2)
      : responseTimeMs;

    await partnerRepository.updateSlaMetric(partnerId, {
      successRate: newRate,
      avgResponseTimeMs: newAvg,
    });
  }

  async recordFailure(partnerId: string, responseTimeMs: number) {
    const metric = await partnerRepository.getOrCreateSlaMetric(partnerId);
    const newFailures = (metric.failureCount || 0) + 1;
    const totalAttempts = metric.successRate !== null
      ? Math.round((metric.successRate * (newFailures)) / (100 - metric.successRate + 0.001)) + newFailures
      : newFailures;
    const successes = totalAttempts - newFailures;
    const newRate = Math.round((successes / totalAttempts) * 100);

    await partnerRepository.updateSlaMetric(partnerId, {
      successRate: newRate,
      failureCount: newFailures,
      avgResponseTimeMs: metric.avgResponseTimeMs
        ? Math.round((metric.avgResponseTimeMs + responseTimeMs) / 2)
        : responseTimeMs,
    });

    if (newRate < 80) {
      logger.warn(`[SLA] Partner ${partnerId} success rate dropped to ${newRate}%`);
    }
  }

  async getMetrics(partnerId: string) {
    return partnerRepository.getOrCreateSlaMetric(partnerId);
  }
}

export const slaMonitorService = new SlaMonitorService();
