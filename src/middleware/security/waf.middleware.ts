import { Request, Response, NextFunction } from "express";
import { metricsService } from "../../modules/production/observability/metrics.service";
import { loggerService } from "../../modules/production/observability/logger.service";

const SQL_INJECTION_PATTERN = /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE|EXEC)\b|'--|'#|1=1)/i;
const XSS_PATTERN = /(<script|javascript:|onerror=|onload=|alert\(|document\.cookie|<iframe|<embed|<object)/i;

export function wafMiddleware(req: Request, res: Response, next: NextFunction) {
  const url = req.url.toLowerCase();
  const body = req.body ? JSON.stringify(req.body).toLowerCase() : "";
  const query = JSON.stringify(req.query).toLowerCase();
  const combined = url + body + query;

  if (SQL_INJECTION_PATTERN.test(combined)) {
    metricsService.increment("waf_sql_injection_blocked");
    loggerService.warn("[WAF] SQL injection pattern blocked", { ip: req.ip, path: req.path });
    return res.status(403).json({ error: "Request blocked by security filter" });
  }

  if (XSS_PATTERN.test(combined)) {
    metricsService.increment("waf_xss_blocked");
    loggerService.warn("[WAF] XSS pattern blocked", { ip: req.ip, path: req.path });
    return res.status(403).json({ error: "Request blocked by security filter" });
  }

  metricsService.increment("api_requests_total");
  next();
}

export function apiGatewayMiddleware(req: Request, _res: Response, next: NextFunction) {
  const start = Date.now();

  const originalEnd = _res.end;
  _res.end = function (this: Response, ...args: Parameters<Response["end"]>) {
    const duration = Date.now() - start;
    metricsService.recordLatency(`api_${req.method}_${req.path}`, duration);
    metricsService.increment(`api_status_${_res.statusCode}`);

    if (duration > 2000) {
      loggerService.warn("[GATEWAY] Slow request detected", {
        method: req.method,
        path: req.path,
        duration,
        status: _res.statusCode,
      });
    }

    return originalEnd.apply(this, args);
  } as Response["end"];

  next();
}
