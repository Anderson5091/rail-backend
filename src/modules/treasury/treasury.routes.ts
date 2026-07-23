import { Router, Response } from "express";
import { prisma } from "../../config/database";
import { ENV } from "../../config/env";
import { authenticate, AuthRequest, requireRole } from "../../middleware/auth";
import { TreasuryOrchestrator } from "./treasury.orchestrator";
import { treasuryRefillService } from "./treasury-refill.service";
import { treasuryBootstrapService } from "./treasury-bootstrap.service";
import { crossmintService } from "../../services/crossmint.service";
import { extractBalance } from "../../utils/balance";
import { liquidityEnforcer } from "../liquidity/liquidity-enforcer.service";
import { logger } from "../../utils/logger";
import type { Chain } from "@crossmint/wallets-sdk";

const router = Router();
const orchestrator = new TreasuryOrchestrator();

router.get("/overview", authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const [wallets, movements, snapshots] = await Promise.all([
      prisma.treasuryWallet.findMany(),
      prisma.treasuryMovement.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
      prisma.liquiditySnapshot.findMany({ orderBy: { createdAt: "desc" }, take: 7 }),
    ]);

    const walletsWithBalance = wallets.map((w: { walletType: string; network: string; balance: any }) => ({
      ...w,
      balance: Number(w.balance),
    }));

    const totalLiquidity = walletsWithBalance.reduce((sum: number, w: { balance: number }) => sum + w.balance, 0);
    const hotTotal = walletsWithBalance.filter((w: { walletType: string }) => w.walletType === "HOT").reduce((sum: number, w: { balance: number }) => sum + w.balance, 0);
    const warmTotal = walletsWithBalance.filter((w: { walletType: string }) => w.walletType === "WARM").reduce((sum: number, w: { balance: number }) => sum + w.balance, 0);
    const coldTotal = walletsWithBalance.filter((w: { walletType: string }) => w.walletType === "COLD").reduce((sum: number, w: { balance: number }) => sum + w.balance, 0);
    const networks = [...new Set(wallets.map((w: { network: string }) => w.network))];

    res.json({ totalLiquidity, hotTotal, warmTotal, coldTotal, networks, wallets: walletsWithBalance, recentMovements: movements, snapshots });

    // Background: sync Crossmint balances (non-blocking, fire-and-forget)
    for (const wallet of wallets) {
      const locator = wallet.walletLocator || wallet.address;
      if (!locator) continue;
      crossmintService.getWalletBalance(locator, [ENV.APP_CURRENCY_TOKEN.toLowerCase()], wallet.chain as Chain)
        .then((balances) => {
          const bal = extractBalance(balances, ENV.APP_CURRENCY_TOKEN.toLowerCase()) || 0;
          if (bal > 0) {
            return prisma.treasuryWallet.update({ where: { id: wallet.id }, data: { balance: bal, lastSync: new Date() } });
          }
        })
        .catch((err) => logger.error(`[Treasury] Crossmint sync failed for wallet ${wallet.id}: ${err}`));
    }
  } catch (error: any) {
    res.status(500).json({ error: `Failed to load treasury data: ${error.message}` });
  }
});

router.get("/liquidity", authenticate, async (_req: AuthRequest, res: Response) => {
  const snapshots = await prisma.liquiditySnapshot.findMany({
    orderBy: { createdAt: "desc" },
    take: 7,
  });

  const wallets = await prisma.treasuryWallet.findMany();

  res.json({ snapshots, wallets });
});

router.get("/solvency", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "TREASURY", "OPS"), async (_req: AuthRequest, res: Response) => {
  try {
    const report = await liquidityEnforcer.getSolvencyReport();
    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: `Failed to get solvency report: ${error.message}` });
  }
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

router.post("/bootstrap", authenticate, requireRole("SUPER_ADMIN", "TREASURY"), async (_req: AuthRequest, res: Response) => {
  try {
    await crossmintService.initialize();
    await treasuryBootstrapService.bootstrapTreasuryWallets();
    const count = await prisma.treasuryWallet.count();
    res.json({ success: true, message: `Treasury wallets bootstrapped. ${count} wallet(s) in inventory.` });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to bootstrap treasury wallets" });
  }
});

router.get("/crossmint-balances", authenticate, requireRole("SUPER_ADMIN", "TREASURY"), async (_req: AuthRequest, res: Response) => {
  const wallets = await prisma.treasuryWallet.findMany({
    where: { walletLocator: { not: null } },
  });

  const results = await Promise.allSettled(
    wallets.map(async (wallet: { walletLocator: string; chain: string; walletType: string; network: string; address: string }) => {
      const chain = wallet.chain as Chain;
      const bal = await crossmintService.getWalletBalance(wallet.walletLocator, [ENV.APP_CURRENCY_TOKEN.toLowerCase()], chain);
      return {
        key: `${wallet.walletType}_${wallet.network}`,
        data: { address: wallet.address, chain: wallet.chain, balance: extractBalance(bal, ENV.APP_CURRENCY_TOKEN.toLowerCase()) || 0, walletLocator: wallet.walletLocator },
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

export { router as treasuryRoutes };
