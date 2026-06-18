import { Router, Response } from "express";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest, requireRole } from "../../middleware/auth";
import { TreasuryOrchestrator } from "./treasury.orchestrator";
import { treasuryRefillService } from "./treasury-refill.service";
import { crossmintService } from "../../services/crossmint.service";

const router = Router();
const orchestrator = new TreasuryOrchestrator();

router.get("/overview", authenticate, async (_req: AuthRequest, res: Response) => {
  const wallets = await prisma.treasuryWallet.findMany();
  const movements = await prisma.treasuryMovement.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const snapshots = await prisma.liquiditySnapshot.findMany({
    orderBy: { createdAt: "desc" },
    take: 7,
  });

  const totalLiquidity = wallets.reduce(
    (sum: number, w: { balance: { toString: () => string } }) => sum + Number(w.balance),
    0
  );
  const hotTotal = wallets
    .filter((w: { walletType: string }) => w.walletType === "HOT")
    .reduce((sum: number, w: { balance: { toString: () => string } }) => sum + Number(w.balance), 0);
  const warmTotal = wallets
    .filter((w: { walletType: string }) => w.walletType === "WARM")
    .reduce((sum: number, w: { balance: { toString: () => string } }) => sum + Number(w.balance), 0);
  const coldTotal = wallets
    .filter((w: { walletType: string }) => w.walletType === "COLD")
    .reduce((sum: number, w: { balance: { toString: () => string } }) => sum + Number(w.balance), 0);
  const networks = [...new Set(wallets.map((w: { network: string }) => w.network))];

  const onChainBalances: Record<string, number> = {};
  for (const wallet of wallets) {
    if (wallet.walletLocator) {
      try {
        const chain = wallet.chain as "base" | "ethereum" | "polygon" | "solana";
        const balances = await crossmintService.getWalletBalance(wallet.walletLocator, ["usdt"], chain);
        const bal = extractBalance(balances, "usdt");
        onChainBalances[`${wallet.walletType}_${wallet.network}`] = bal;
      } catch {
        onChainBalances[`${wallet.walletType}_${wallet.network}`] = 0;
      }
    }
  }

  res.json({ totalLiquidity, hotTotal, warmTotal, coldTotal, networks, wallets, recentMovements: movements, snapshots });
});

router.get("/liquidity", authenticate, async (_req: AuthRequest, res: Response) => {
  const snapshots = await prisma.liquiditySnapshot.findMany({
    orderBy: { createdAt: "desc" },
    take: 7,
  });

  const wallets = await prisma.treasuryWallet.findMany();

  res.json({ snapshots, wallets });
});

router.post("/rebalance", authenticate, requireRole("SUPER_ADMIN", "TREASURY"), async (req: AuthRequest, res: Response) => {
  const { network } = req.body;
  const result = await orchestrator.rebalance(network);
  res.json(result);
});

router.post("/refill", authenticate, requireRole("SUPER_ADMIN", "TREASURY"), async (_req: AuthRequest, res: Response) => {
  await treasuryRefillService.checkAndRefillAllNetworks();
  res.json({ success: true, message: "Refill check complete across all networks" });
});

router.post("/snapshot", authenticate, requireRole("SUPER_ADMIN", "TREASURY"), async (_req: AuthRequest, res: Response) => {
  await treasuryRefillService.recordLiquiditySnapshot();
  res.json({ success: true, message: "Liquidity snapshot recorded" });
});

router.get("/crossmint-balances", authenticate, requireRole("SUPER_ADMIN", "TREASURY"), async (_req: AuthRequest, res: Response) => {
  const wallets = await prisma.treasuryWallet.findMany({
    where: { walletLocator: { not: null } },
  });

  const balances: Record<string, unknown> = {};
  for (const wallet of wallets) {
    if (wallet.walletLocator) {
      try {
        const bal = await crossmintService.getWalletBalance(wallet.walletLocator, ["usdt"]);
        balances[`${wallet.walletType}_${wallet.network}`] = {
          address: wallet.address,
          chain: wallet.chain,
          balance: bal,
          walletLocator: wallet.walletLocator,
        };
      } catch {
        balances[`${wallet.walletType}_${wallet.network}`] = { error: "Failed to fetch balance" };
      }
    }
  }

  res.json(balances);
});

function extractBalance(balances: unknown, token: string): number {
  if (typeof balances === "object" && balances !== null) {
    if (Array.isArray(balances)) {
      const entry = balances.find(
        (b: Record<string, unknown>) =>
          String(b.token || "").toLowerCase() === token ||
          String(b.symbol || "").toLowerCase() === token
      );
      return entry ? Number(entry.amount || entry.balance || 0) : 0;
    }
    return Number((balances as Record<string, unknown>)[token] || 0);
  }
  return 0;
}

export { router as treasuryRoutes };
