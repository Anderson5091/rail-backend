type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  data?: unknown;
  timestamp: string;
  service: string;
}

export class LoggerService {
  private currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
  private service = "quicksend-api";

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    return levels.indexOf(level) >= levels.indexOf(this.currentLevel);
  }

  private write(level: LogLevel, message: string, data?: unknown) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      data,
      timestamp: new Date().toISOString(),
      service: this.service,
    };

    const output = JSON.stringify(entry);
    switch (level) {
      case "error": console.error(output); break;
      case "warn": console.warn(output); break;
      default: console.log(output); break;
    }
  }

  debug(message: string, data?: unknown) { this.write("debug", message, data); }
  info(message: string, data?: unknown) { this.write("info", message, data); }
  warn(message: string, data?: unknown) { this.write("warn", message, data); }
  error(message: string, data?: unknown) { this.write("error", message, data); }

  getLevel() { return this.currentLevel; }
  setLevel(level: LogLevel) { this.currentLevel = level; }
}

export const loggerService = new LoggerService();
