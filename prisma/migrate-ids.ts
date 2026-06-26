// Run: npx tsx prisma/migrate-ids.ts
// Migrates existing record IDs to the new QS prefixed format.
// Uses INSERT-new + UPDATE-children + DELETE-old approach to avoid FK issues.

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

function add(label: string, rows: { id: string }[], prefixOrFn: string | ((row: any) => string), suffixLen = 14) {
  maps[label] = {};
  for (const row of rows) {
    const prefix = typeof prefixOrFn === "function" ? prefixOrFn(row) : prefixOrFn;
    maps[label][row.id] = `${prefix}${rand(suffixLen)}`;
  }
}

// List of (childTable, fkColumn, parentModel)
const FK_CHILDREN: [string, string, string][] = [
  ["AgentWallet", "agentId", "Agent"],
  ["AgentTransaction", "agentId", "Agent"],
  ["AgentKpi", "agentId", "Agent"],
  ["Transfer", "agentId", "Agent"],
  ["Wallet", "userId", "User"],
  ["Transfer", "userId", "User"],
  ["Beneficiary", "userId", "User"],
  ["KycProfile", "userId", "User"],
  ["ComplianceCase", "userId", "User"],
  ["DepositWallet", "userId", "User"],
  ["Notification", "userId", "User"],
  ["AmlCheck", "userId", "User"],
  ["KycDocument", "userId", "User"],
  ["RiskScore", "userId", "User"],
  ["SanctionsHit", "userId", "User"],
  ["AdminActionLog", "adminId", "AdminUser"],
];

async function migrate() {
  console.log("Fetching existing records…");

  const [users, agents, admins, partners] = await Promise.all([
    prisma.user.findMany(),
    prisma.agent.findMany(),
    prisma.adminUser.findMany(),
    prisma.partner.findMany(),
  ]);

  add("User", users, "QSU");
  add("Agent", agents, (a: any) => a.type === "INTERNAL" ? "QSIA-" : "QSPA-");
  add("AdminUser", admins, (a: any) => {
    const m: Record<string, string> = { SUPER_ADMIN: "QS-SAD-", OPS: "QS-OPS-", TREASURY: "QS-TRE-", COMPLIANCE: "QS-COM-" };
    return m[a.role] || "QS-ADM-";
  }, 6);
  add("Partner", partners, "QSP");

  const total = Object.values(maps).reduce((s, m) => s + Object.keys(m).length, 0);
  if (total === 0) {
    console.log("No records to migrate.");
    await prisma.$disconnect();
    return;
  }
  console.log(`Migrating ${total} records (${users.length} users, ${agents.length} agents, ${admins.length} admins, ${partners.length} partners)`);

  try {
    await prisma.$transaction(async (tx) => {
      // Step 1: For each parent, INSERT new rows with new IDs (copying all columns)
      for (const [table, rows] of Object.entries({ User: users, Agent: agents, AdminUser: admins, Partner: partners } as Record<string, any[]>)) {
        const idMap = maps[table];
        if (!idMap) continue;
        for (const row of rows) {
          const newId = idMap[row.id];
          const cols = Object.keys(row).filter(k => k !== "id" && k !== "createdAt" && k !== "updatedAt");
          const colList = cols.map(c => `"${c}"`).join(",");
          const valList = cols.map((c) => {
            const v = row[c];
            if (v === null || v === undefined) return "NULL";
            if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
            if (v instanceof Date) return `'${v.toISOString()}'`;
            return v.toString();
          }).join(",");
          const sql = `INSERT INTO "${table}" ("id", ${colList}) VALUES ('${newId}', ${valList}) ON CONFLICT DO NOTHING`;
          await tx.$executeRawUnsafe(sql);
        }
        console.log(`  INSERTED ${rows.length} new ${table} rows with new IDs`);
      }

      // Step 2: Update child FKs to point to new parent IDs
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

      // Step 3: Delete old parent rows
      for (const table of ["User", "Agent", "AdminUser", "Partner"]) {
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
