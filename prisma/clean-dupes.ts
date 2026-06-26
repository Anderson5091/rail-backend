// Removes duplicate (fromCurrency, toCurrency) rows before the unique constraint is applied.
// Run as part of preDeployCommand on Railway.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rates = await prisma.fxRate.findMany({ orderBy: { updatedAt: "desc" } });

  const seen = new Set<string>();
  let deleted = 0;

  for (const r of rates) {
    const key = `${r.fromCurrency}|${r.toCurrency}`;
    if (seen.has(key)) {
      await prisma.fxRate.delete({ where: { id: r.id } });
      deleted++;
      console.log(`Deleted duplicate: ${r.fromCurrency}->${r.toCurrency} (${r.id})`);
    }
    seen.add(key);
  }

  console.log(`Done. ${deleted} duplicate(s) removed, ${seen.size} unique pair(s) kept.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
