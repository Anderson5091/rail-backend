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

  const results = await Promise.allSettled(
    wallets.map(async (wallet: { id: string; walletLocator: string | null; address: string; chain: string; walletType: string; network: string }) => {
      // Use walletLocator if available, otherwise fall back to the blockchain address (also a valid Crossmint locator)
      const locator = wallet.walletLocator || wallet.address;
      if (!locator) return { key: `${wallet.walletType}_${wallet.network}`, balance: 0 };

      const chain = wallet.chain as "base" | "ethereum" | "polygon" | "solana";
      try {
        const balances = await crossmintService.getWalletBalance(locator, ["usdc", "usdt", "usdxm"], chain);
        const bal = extractBalance(balances, "usdc") || extractBalance(balances, "usdt") || extractBalance(balances, "usdxm") || 0;

        // Persist the synced balance back to DB so dashboard totals stay accurate
        if (bal > 0) {
          await prisma.treasuryWallet.update({ where: { id: wallet.id }, data: { balance: bal, lastSync: new Date() } });
        }

        return { key: `${wallet.walletType}_${wallet.network}`, balance: bal };
      } catch {
        return { key: `${wallet.walletType}_${wallet.network}`, balance: Number((wallet as any).balance) || 0 };
      }
    })
  );

  const onChainBalances: Record<string, number> = {};
  for (const result of results) {
    if (result.status === "fulfilled") {
      onChainBalances[result.value.key] = result.value.balance;
    }
  }

  const walletsWithBalance = wallets.map((w: { walletType: string; network: string; balance: { toString: () => string } }) => ({
    ...w,
    balance: onChainBalances[`${w.walletType}_${w.network}`] ?? Number(w.balance),
  }));

  const totalLiquidity = walletsWithBalance.reduce((sum: number, w: { balance: number }) => sum + w.balance, 0);
  const hotTotal = walletsWithBalance
    .filter((w: { walletType: string }) => w.walletType === "HOT")
    .reduce((sum: number, w: { balance: number }) => sum + w.balance, 0);
  const warmTotal = walletsWithBalance
    .filter((w: { walletType: string }) => w.walletType === "WARM")
    .reduce((sum: number, w: { balance: number }) => sum + w.balance, 0);
  const coldTotal = walletsWithBalance
    .filter((w: { walletType: string }) => w.walletType === "COLD")
    .reduce((sum: number, w: { balance: number }) => sum + w.balance, 0);
  const networks = [...new Set(wallets.map((w: { network: string }) => w.network))];

  res.json({ totalLiquidity, hotTotal, warmTotal, coldTotal, networks, wallets: walletsWithBalance, recentMovements: movements, snapshots });

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

  const results = await Promise.allSettled(
    wallets.map(async (wallet: { walletLocator: string; chain: string; walletType: string; network: string; address: string }) => {
      const chain = wallet.chain as "base" | "ethereum" | "polygon" | "solana";
      const bal = await crossmintService.getWalletBalance(wallet.walletLocator, ["usdc", "usdt", "usdxm"], chain);
      return {
        key: `${wallet.walletType}_${wallet.network}`,
        data: { address: wallet.address, chain: wallet.chain, balance: extractBalance(bal, "usdc") || extractBalance(bal, "usdt") || extractBalance(bal, "usdxm") || 0, walletLocator: wallet.walletLocator },
      };
    })
  );

  const balances: Record<string, unknown> = {};
  for (const result of results) {
    if (result.status === "fulfilled") {
      balances[result.value.key] = result.value.data;
    }
  }

  res.json(balances);
});

function extractBalance(balances: unknown, token: string): number {
  if (typeof balances !== "object" || balances === null) return 0;
  // Check the tokens array for the requested token
  const tokensArray = (balances as Record<string, unknown>).tokens;
  if (Array.isArray(tokensArray)) {
    const match = tokensArray.find(
      (t: Record<string, unknown>) =>
        String(t.symbol || "").toLowerCase() === token.toLowerCase()
    );
    if (match) return Number(match.amount) || 0;
  }
  // Fall back to named property (e.g. balances.usdc / balances.usdxm / balances.nativeToken)
  const entry = (balances as Record<string, unknown>)[token];
  if (!entry) {
    if (token === "native") {
      const native = (balances as Record<string, unknown>).nativeToken;
      if (native && typeof native === "object") {
        return Number((native as Record<string, unknown>).amount) || 0;
      }
    }
    return 0;
  }
  if (typeof entry === "number") return entry;
  if (typeof entry === "string") return Number(entry) || 0;
  if (typeof entry === "object" && entry !== null) {
    const amt = (entry as Record<string, unknown>).amount;
    return Number(amt) || 0;
  }
  return 0;
}

export { router as treasuryRoutes };
