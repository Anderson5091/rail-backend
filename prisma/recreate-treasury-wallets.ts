import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createCrossmint, CrossmintWallets } from "@crossmint/wallets-sdk";
import dotenv from "dotenv";

dotenv.config();

const adapter = new PrismaPg(process.env.DATABASE_URL || "");
const prisma = new PrismaClient({ adapter });

const WALLET_TIERS = [
  { walletType: "HOT",  thresholdMin: parseFloat(process.env.HOT_THRESHOLD_MIN || "20000") },
  { walletType: "WARM", thresholdMin: parseFloat(process.env.WARM_THRESHOLD_MIN || "250000") },
  { walletType: "COLD", thresholdMin: undefined as number | undefined },
];

const NETWORKS = [
  { network: "BASE",     chain: "base-sepolia"     as const },
  { network: "ETHEREUM", chain: "ethereum-sepolia" as const },
  { network: "SOLANA",   chain: "solana"           as const },
  { network: "POLYGON",  chain: "polygon-amoy"     as const },
];

const OWNER = "email:treasury@quicksend.com.mx";
const CROSSMINT_API_KEY = process.env.CROSSMINT_API_KEY || "";
const TREASURY_RECOVERY_SECRET = process.env.TREASURY_RECOVERY_SECRET || "";

async function main() {
  console.log("=== Recreating Treasury Wallets via Crossmint SDK ===\n");

  if (!CROSSMINT_API_KEY || !TREASURY_RECOVERY_SECRET) {
    console.error("Missing required env: CROSSMINT_API_KEY, TREASURY_RECOVERY_SECRET");
    process.exit(1);
  }

  const crossmint = createCrossmint({ apiKey: CROSSMINT_API_KEY });
  const walletsSdk = CrossmintWallets.from(crossmint);

  const createdWallets: { network: string; walletType: string; address: string; locator: string }[] = [];

  for (const { network, chain } of NETWORKS) {
    for (const { walletType, thresholdMin } of WALLET_TIERS) {
      const alias = `treasury-${network.toLowerCase()}-${walletType.toLowerCase()}`;

      console.log(`Creating ${network} ${walletType} wallet (alias: ${alias})...`);

      const wallet = await walletsSdk.createWallet({
        chain,
        owner: OWNER,
        alias,
        recovery: { type: "server", secret: TREASURY_RECOVERY_SECRET },
      });

      console.log(`  ✅ Created: ${wallet.address}`);

      // Delete existing record for this (walletType, chain) to avoid unique constraint conflicts
      const existing = await prisma.treasuryWallet.findFirst({
        where: { walletType, chain },
      });

      if (existing) {
        // If address changed, delete old record first (address is unique)
        if (existing.address !== wallet.address) {
          await prisma.treasuryWallet.delete({ where: { id: existing.id } });
          await prisma.treasuryWallet.create({
            data: {
              walletType,
              chain,
              network,
              address: wallet.address,
              crossmintWalletId: wallet.address,
              walletLocator: wallet.address,
              thresholdMin: thresholdMin ?? null,
              status: "ACTIVE",
            },
          });
          console.log(`  ✅ DB REPLACED [${network}] ${walletType}: ${wallet.address}`);
        } else {
          await prisma.treasuryWallet.update({
            where: { id: existing.id },
            data: {
              network,
              crossmintWalletId: wallet.address,
              walletLocator: wallet.address,
              thresholdMin: thresholdMin ?? null,
              status: "ACTIVE",
              lastSync: new Date(),
            },
          });
          console.log(`  ✅ DB UPDATED [${network}] ${walletType}: ${wallet.address}`);
        }
      } else {
        await prisma.treasuryWallet.create({
          data: {
            walletType,
            chain,
            network,
            address: wallet.address,
            crossmintWalletId: wallet.address,
            walletLocator: wallet.address,
            thresholdMin: thresholdMin ?? null,
            status: "ACTIVE",
          },
        });
        console.log(`  ✅ DB CREATED [${network}] ${walletType}: ${wallet.address}`);
      }

      createdWallets.push({ network, walletType, address: wallet.address, locator: wallet.address });
    }
  }

  console.log("\n\n=== NEW TREASURY WALLET ADDRESSES ===");
  console.log("| Network | Chain ID | HOT | WARM | COLD |");
  console.log("|---------|----------|-----|------|------|");
  for (const { network, chain } of NETWORKS) {
    const hot = createdWallets.find(w => w.network === network && w.walletType === "HOT");
    const warm = createdWallets.find(w => w.network === network && w.walletType === "WARM");
    const cold = createdWallets.find(w => w.network === network && w.walletType === "COLD");
    console.log(`| ${network} | ${chain} | \`${hot?.address}\` | \`${warm?.address}\` | \`${cold?.address}\` |`);
  }

  const total = await prisma.treasuryWallet.count();
  console.log(`\n=== Done. Total treasury wallets in DB: ${total} ===`);
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
