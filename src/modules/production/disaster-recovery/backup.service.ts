import { loggerService } from "../observability/logger.service";
import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BACKUP_DIR = process.env.BACKUP_DIR || "./backups";

export class BackupService {
  async dailyBackup(): Promise<{ status: string; path?: string; error?: string }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `quicksend-backup-${timestamp}.sql`;
    const filepath = join(BACKUP_DIR, filename);

    try {
      if (!existsSync(BACKUP_DIR)) {
        mkdirSync(BACKUP_DIR, { recursive: true });
      }

      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) throw new Error("DATABASE_URL not set");

      loggerService.info(`[BACKUP] Starting backup to ${filepath}`);

      execSync(`pg_dump "${dbUrl}" > "${filepath}"`, { timeout: 300000 });

      loggerService.info(`[BACKUP] Completed: ${filepath}`);
      return { status: "SUCCESS", path: filepath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      loggerService.error(`[BACKUP] Failed: ${message}`);
      return { status: "FAILED", error: message };
    }
  }

  async restore(backupPath: string): Promise<{ status: string; error?: string }> {
    try {
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) throw new Error("DATABASE_URL not set");

      loggerService.info(`[RESTORE] Starting restore from ${backupPath}`);

      execSync(`psql "${dbUrl}" < "${backupPath}"`, { timeout: 600000 });

      loggerService.info("[RESTORE] Completed");
      return { status: "SUCCESS" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      loggerService.error(`[RESTORE] Failed: ${message}`);
      return { status: "FAILED", error: message };
    }
  }

  async listBackups(): Promise<string[]> {
    if (!existsSync(BACKUP_DIR)) return [];
    const { readdirSync } = await import("fs");
    return readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .reverse();
  }
}

export const backupService = new BackupService();
