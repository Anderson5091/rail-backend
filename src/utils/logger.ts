const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(currentLevel);
}

export const logger = {
  debug: (...args: unknown[]) => shouldLog("debug") && console.debug("[DEBUG]", ...args),
  info: (...args: unknown[]) => shouldLog("info") && console.info("[INFO]", ...args),
  warn: (...args: unknown[]) => shouldLog("warn") && console.warn("[WARN]", ...args),
  error: (...args: unknown[]) => shouldLog("error") && console.error("[ERROR]", ...args),
};
