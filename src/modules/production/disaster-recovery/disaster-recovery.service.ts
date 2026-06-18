import { loggerService } from "../observability/logger.service";
import { backupService } from "./backup.service";

export class DisasterRecoveryService {
  async runBackup() {
    loggerService.info("[DR] Starting disaster recovery backup...");
    const result = await backupService.dailyBackup();
    loggerService.info("[DR] Backup result", result);
    return result;
  }

  async restoreFromBackup(backupPath: string) {
    loggerService.info(`[DR] Starting disaster recovery restore from ${backupPath}`);
    const result = await backupService.restore(backupPath);
    loggerService.info("[DR] Restore result", result);
    return result;
  }

  async getSystemStatus() {
    const backups = await backupService.listBackups();
    const { execSync } = await import("child_process");
    let diskFree = "";

    try {
      diskFree = execSync("df -h / | tail -1").toString().trim();
    } catch {
      diskFree = "unavailable";
    }

    return {
      healthy: true,
      lastBackup: backups[0] || null,
      availableBackups: backups.length,
      disk: diskFree,
      timestamp: new Date().toISOString(),
    };
  }
}

export const disasterRecoveryService = new DisasterRecoveryService();
