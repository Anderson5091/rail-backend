// Run: npx tsx prisma/migrate-ids.ts
// Migrates ALL table record IDs to QS-prefixed format (e.g. QSU..., QSW..., QSTR...)
// Uses INSERT-new + UPDATE-children + DELETE-old 3-phase approach to avoid FK issues.

import { PrismaClient } from "@prisma/client";
import * as crypto from "node:crypto";

const prisma = new PrismaClient();

const ALPHANUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function rand(length: number): string {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += ALPHANUM[bytes[i] % ALPHANUM.length];
  }
  return result;
}

type IdMap = Record<string, string>;
const maps: Record<string, IdMap> = {};

function add(model: string, rows: { id: string }[], prefixOrFn: string | ((row: any) => string), suffixLen = 14) {
  maps[model] = {};
  for (const row of rows) {
    const prefix = typeof prefixOrFn === "function" ? prefixOrFn(row) : prefixOrFn;
    const separator = prefix.endsWith("-") ? "" : "";
    maps[model][row.id] = `${prefix}${separator}${rand(suffixLen)}`;
  }
}

// FK relationships: [childTable, fkColumn, parentModel]
const FK_CHILDREN: [string, string, string][] = [
  // User children
  ["Wallet", "userId", "User"],
  ["OtpCode", "userId", "User"],
  ["Beneficiary", "userId", "User"],
  ["KycProfile", "userId", "User"],
  ["KycDocument", "userId", "User"],
  ["AmlCheck", "userId", "User"],
  ["SanctionsHit", "userId", "User"],
  ["ComplianceCase", "userId", "User"],
  ["RiskScore", "userId", "User"],
  ["Notification", "userId", "User"],
  ["DepositWallet", "userId", "User"],
  ["Withdrawal", "userId", "User"],
  ["Transfer", "userId", "User"],
  ["DepositRequest", "userId", "User"],
  // Wallet children
  ["WalletAddress", "walletId", "Wallet"],
  ["WalletTransaction", "walletId", "Wallet"],
  ["LedgerEntry", "walletId", "Wallet"],
  ["Withdrawal", "walletId", "Wallet"],
  // Transfer children
  ["PayoutOrder", "transferId", "Transfer"],
  ["PartnerTransaction", "transferId", "Transfer"],
  // PayoutOrder children
  ["PayoutEvent", "payoutOrderId", "PayoutOrder"],
  ["PartnerLog", "payoutOrderId", "PayoutOrder"],
  // TreasuryWallet children
  ["TreasuryMovement", "fromWalletId", "TreasuryWallet"],
  ["TreasuryMovement", "toWalletId", "TreasuryWallet"],
  // DepositWallet children
  ["DepositRequest", "depositWalletId", "DepositWallet"],
  // Notification children
  ["NotificationDelivery", "notificationId", "Notification"],
  // Partner children
  ["PartnerTransaction", "partnerId", "Partner"],
  ["PartnerWebhook", "partnerId", "Partner"],
  ["PartnerSlaMetric", "partnerId", "Partner"],
  // Agent children
  ["AgentLedgerEntry", "agentId", "Agent"],
  ["AgentWallet", "agentId", "Agent"],
  ["AgentTransaction", "agentId", "Agent"],
  ["AgentKpi", "agentId", "Agent"],
  // AdminUser children
  ["AdminActionLog", "adminId", "AdminUser"],
];

function agentPrefix(row: any): string {
  if (row.type === "INTERNAL") return "QSIA-";
  if (row.type === "PARTNER") return "QSPA-";
  return "QSA-";
}

function adminPrefix(row: any): string {
  const m: Record<string, string> = {
    SUPER_ADMIN: "QS-SAD-",
    OPS: "QS-OPS-",
    TREASURY: "QS-TRE-",
    COMPLIANCE: "QS-COM-",
  };
  return m[row.role] || "QS-ADM-";
}

async function migrate() {
  console.log("Fetching all records…");

  const allData: Record<string, any[]> = {};

  const models = [
    "user", "otpCode", "wallet", "walletAddress", "walletTransaction", "ledgerEntry",
    "beneficiary", "fxRate", "feeRule", "transfer", "payoutOrder", "payoutEvent",
    "partnerLog", "treasuryWallet", "treasuryMovement", "liquiditySnapshot",
    "depositRequest", "depositWallet", "withdrawal", "kycProfile", "kycDocument",
    "amlCheck", "sanctionsHit", "complianceCase", "riskScore", "event",
    "notification", "notificationDelivery", "eventLog",
    "partner", "partnerTransaction", "partnerWebhook", "partnerSlaMetric",
    "adminUser", "agent", "agentLedgerEntry", "agentWallet", "agentTransaction",
    "agentKpi", "adminActionLog", "systemAlert",
  ];

  for (const m of models) {
    try {
      allData[m] = await (prisma as any)[m].findMany();
    } catch {
      allData[m] = [];
    }
  }

  // Generate new IDs for all models that have records
  add("User", allData.user || [], "QSU");
  add("Agent", allData.agent || [], agentPrefix);
  add("AdminUser", allData.adminUser || [], adminPrefix, 6);
  add("Partner", allData.partner || [], "QSP");

  add("Wallet", allData.wallet || [], "QSW");
  add("WalletAddress", allData.walletAddress || [], "QSWA");
  add("WalletTransaction", allData.walletTransaction || [], "QSWT");
  add("LedgerEntry", allData.ledgerEntry || [], "QSLE");
  add("OtpCode", allData.otpCode || [], "QSOTP");
  add("Beneficiary", allData.beneficiary || [], "QSB");
  add("FxRate", allData.fxRate || [], "QSFR");
  add("FeeRule", allData.feeRule || [], "QSFE");
  add("Transfer", allData.transfer || [], "QSTR");
  add("PayoutOrder", allData.payoutOrder || [], "QSPO");
  add("PayoutEvent", allData.payoutEvent || [], "QSPE");
  add("PartnerLog", allData.partnerLog || [], "QSPLG");
  add("TreasuryWallet", allData.treasuryWallet || [], "QSTW");
  add("TreasuryMovement", allData.treasuryMovement || [], "QSTM");
  add("LiquiditySnapshot", allData.liquiditySnapshot || [], "QSLS");
  add("DepositRequest", allData.depositRequest || [], "QSDR");
  add("DepositWallet", allData.depositWallet || [], "QSDW");
  add("Withdrawal", allData.withdrawal || [], "QSWD");
  add("KycProfile", allData.kycProfile || [], "QSKP");
  add("KycDocument", allData.kycDocument || [], "QSKD");
  add("AmlCheck", allData.amlCheck || [], "QSAC");
  add("SanctionsHit", allData.sanctionsHit || [], "QSSH");
  add("ComplianceCase", allData.complianceCase || [], "QSCC");
  add("RiskScore", allData.riskScore || [], "QSRS");
  add("Event", allData.event || [], "QSEV");
  add("Notification", allData.notification || [], "QSN");
  add("NotificationDelivery", allData.notificationDelivery || [], "QSND");
  add("EventLog", allData.eventLog || [], "QSEL");
  add("PartnerTransaction", allData.partnerTransaction || [], "QSPT");
  add("PartnerWebhook", allData.partnerWebhook || [], "QSPW");
  add("PartnerSlaMetric", allData.partnerSlaMetric || [], "QSPS");
  add("AgentLedgerEntry", allData.agentLedgerEntry || [], "QSALE");
  add("AgentWallet", allData.agentWallet || [], "QSAW");
  add("AgentTransaction", allData.agentTransaction || [], "QSAT");
  add("AgentKpi", allData.agentKpi || [], "QSAK");
  add("AdminActionLog", allData.adminActionLog || [], "QSAL");
  add("SystemAlert", allData.systemAlert || [], "QSSA");

  const total = Object.values(maps).reduce((s, m) => s + Object.keys(m).length, 0);
  if (total === 0) {
    console.log("No records to migrate.");
    await prisma.$disconnect();
    return;
  }

  const counts = Object.entries(maps)
    .filter(([, m]) => Object.keys(m).length > 0)
    .map(([t, m]) => `${t}: ${Object.keys(m).length}`)
    .join(", ");
  console.log(`Migrating ${total} records (${counts})`);

  const allModelNames = [
    "User", "Agent", "AdminUser", "Partner",
    "Wallet", "WalletAddress", "WalletTransaction", "LedgerEntry",
    "OtpCode", "Beneficiary", "FxRate", "FeeRule", "Transfer",
    "PayoutOrder", "PayoutEvent", "PartnerLog",
    "TreasuryWallet", "TreasuryMovement", "LiquiditySnapshot",
    "DepositRequest", "DepositWallet", "Withdrawal",
    "KycProfile", "KycDocument", "AmlCheck", "SanctionsHit",
    "ComplianceCase", "RiskScore", "Event",
    "Notification", "NotificationDelivery", "EventLog",
    "PartnerTransaction", "PartnerWebhook", "PartnerSlaMetric",
    "AgentLedgerEntry", "AgentWallet", "AgentTransaction", "AgentKpi",
    "AdminActionLog", "SystemAlert",
  ];

  try {
    await prisma.$transaction(async (tx) => {
      // Phase 1: INSERT new rows with new IDs (copy all columns except id/createdAt/updatedAt)
      for (const table of allModelNames) {
        const idMap = maps[table];
        if (!idMap || Object.keys(idMap).length === 0) continue;
        const camelKey = table[0].toLowerCase() + table.slice(1);
        const data = allData[camelKey] || [];
        for (const row of data) {
          const newId = idMap[row.id];
          if (!newId) continue;
          const cols = Object.keys(row).filter(k => k !== "id" && k !== "createdAt" && k !== "updatedAt");
          const colList = cols.map(c => `"${c}"`).join(",");
          const valList = cols.map(c => {
            const v = row[c];
            if (v === null || v === undefined) return "NULL";
            if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
            if (v instanceof Date) return `'${v.toISOString()}'`;
            return v.toString();
          }).join(",");
          const sql = `INSERT INTO "${table}" ("id", ${colList}) VALUES ('${newId}', ${valList}) ON CONFLICT DO NOTHING`;
          await tx.$executeRawUnsafe(sql);
        }
        console.log(`  INSERTED ${data.length} new ${table} rows`);
      }

      // Phase 2: UPDATE child FK columns from old parent IDs to new parent IDs
      for (const [childTable, fkCol, parentModel] of FK_CHILDREN) {
        const parentMap = maps[parentModel];
        if (!parentMap || Object.keys(parentMap).length === 0) continue;
        const cases = Object.entries(parentMap)
          .map(([oldId, newId]) => `WHEN '${oldId}' THEN '${newId}'`)
          .join(" ");
        const ids = Object.keys(parentMap).map(k => `'${k}'`).join(",");
        const sql = `UPDATE "${childTable}" SET "${fkCol}" = CASE "${fkCol}" ${cases} END WHERE "${fkCol}" IN (${ids})`;
        try {
          const r = await tx.$executeRawUnsafe(sql);
          if (r > 0) console.log(`  UPDATED ${r} ${childTable}.${fkCol} references`);
        } catch {
          // table may not exist or have no matching rows
        }
      }

      // Phase 3: DELETE old parent rows
      for (const table of allModelNames) {
        const idMap = maps[table];
        if (!idMap || Object.keys(idMap).length === 0) continue;
        const ids = Object.keys(idMap).map(k => `'${k}'`).join(",");
        const sql = `DELETE FROM "${table}" WHERE "id" IN (${ids})`;
        const r = await tx.$executeRawUnsafe(sql);
        console.log(`  DELETED ${r} old ${table} rows`);
      }
    });

    console.log("Migration complete.");
  } catch (err) {
    console.error("Migration failed. Error:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

migrate();
