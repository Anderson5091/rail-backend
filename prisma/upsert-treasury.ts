import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";

dotenv.config();

const adapter = new PrismaPg(process.env.DATABASE_URL || "");
const prisma = new PrismaClient({ adapter });

const TREASURY_WALLETS = [
  // BASE
  { walletType: "HOT",  chain: "base-sepolia",      network: "BASE",     address: "0x68C2DC7147B87d49b2cf683b9dD63F3F97e461b8" },
  { walletType: "WARM", chain: "base-sepolia",      network: "BASE",     address: "0xea7a7B9C85965c4ce7CeB3B4e2b978F0F2EAB195" },
  { walletType: "COLD", chain: "base-sepolia",      network: "BASE",     address: "0xFE7Be3090Da132C32367555365E5b80B71ac3C00" },
  // ETHEREUM
  { walletType: "HOT",  chain: "ethereum-sepolia",  network: "ETHEREUM", address: "0x0ec5aD4038FA8233a45Bd90574725aBe464E0dDd" },
  { walletType: "WARM", chain: "ethereum-sepolia",  network: "ETHEREUM", address: "0xB6344a9bD24c9F9299DF038086944c063a007a2A" },
  { walletType: "COLD", chain: "ethereum-sepolia",  network: "ETHEREUM", address: "0x1Ec833d9AE8b44d9d4B10baf201A607024032eF3" },
  // SOLANA
  { walletType: "HOT",  chain: "solana",            network: "SOLANA",   address: "8G8sdgViXMJa42FLRQSuta7qqa5Semk2fAEggYDZBbeN" },
  { walletType: "WARM", chain: "solana",            network: "SOLANA",   address: "CjkH41rHXbbrTJb3bMKVMu5ELG7TuHtu4E11HnHYNnxg" },
  { walletType: "COLD", chain: "solana",            network: "SOLANA",   address: "GVQ41fgiLeWsXBcQ1myEZKcQJUngZzrBcUYXLiqpkC9T" },
  // POLYGON
  { walletType: "HOT",  chain: "polygon-amoy",      network: "POLYGON",  address: "0xe6fb5d72925aBb5550e1d5c038e6a8dB9D195bcc" },
  { walletType: "WARM", chain: "polygon-amoy",      network: "POLYGON",  address: "0xee2Ad0F05B8A9C6B8e362505727BF9a6B04BbCA9" },
  { walletType: "COLD", chain: "polygon-amoy",      network: "POLYGON",  address: "0x70bdD4d570f5A988E255A23e26Aba8C2A534C8d9" },
];

async function main() {
  console.log("=== Upserting Treasury Wallets (4 chains × 3 tiers) ===\n");

  for (const tw of TREASURY_WALLETS) {
    // Find existing record by (walletType, chain) — the canonical identity
    const existing = await prisma.treasuryWallet.findFirst({
      where: { walletType: tw.walletType, chain: tw.chain },
    });

    if (existing) {
      if (existing.address !== tw.address) {
        // Update address and network if they differ
        await prisma.treasuryWallet.update({
          where: { id: existing.id },
          data: { address: tw.address, network: tw.network, status: "ACTIVE" },
        });
        console.log(`✅ UPDATED  [${tw.network}] ${tw.walletType}: ${existing.address} → ${tw.address}`);
      } else {
        console.log(`   SKIPPED  [${tw.network}] ${tw.walletType}: ${tw.address} (unchanged)`);
      }
    } else {
      await prisma.treasuryWallet.create({
        data: {
          walletType: tw.walletType,
          chain: tw.chain,
          network: tw.network,
          address: tw.address,
          status: "ACTIVE",
        },
      });
      console.log(`✅ CREATED  [${tw.network}] ${tw.walletType}: ${tw.address}`);
    }
  }

  const total = await prisma.treasuryWallet.count();
  console.log(`\n=== Done. Total treasury wallets in DB: ${total} ===`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
