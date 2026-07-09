import { Router, Response } from "express";
import { authenticate, AuthRequest, requireRole } from "../../middleware/auth";
import { treasuryRampService } from "./treasury-ramp.service";

const router = Router();

router.get("/onramp/info", authenticate, requireRole("SUPER_ADMIN", "TREASURY", "ADMIN"), async (_req: AuthRequest, res: Response) => {
  try {
    const info = await treasuryRampService.getOnrampInfo();
    res.json(info);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/onramp/transfers", authenticate, requireRole("SUPER_ADMIN", "TREASURY", "ADMIN"), async (_req: AuthRequest, res: Response) => {
  try {
    const transfers = await treasuryRampService.getOnrampTransfers();
    res.json(transfers);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/onramp/transfers", authenticate, requireRole("SUPER_ADMIN", "TREASURY"), async (req: AuthRequest, res: Response) => {
  try {
    const { chain, fiatAmount, memoCode, notes, destinationWalletType } = req.body;
    if (!chain || !fiatAmount) {
      res.status(400).json({ error: "chain and fiatAmount are required" });
      return;
    }
    const result = await treasuryRampService.createOnrampTransfer({ chain, fiatAmount, memoCode, notes, destinationWalletType });
    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/onramp/card", authenticate, requireRole("SUPER_ADMIN", "TREASURY"), async (req: AuthRequest, res: Response) => {
  try {
    const { chain, amount, receiptEmail, destinationWalletType } = req.body;
    if (!chain || !amount) {
      res.status(400).json({ error: "chain and amount are required" });
      return;
    }
    const result = await treasuryRampService.createCardDeposit({
      chain,
      amount,
      receiptEmail,
      destinationWalletType,
      createdBy: req.userId || "ADMIN",
    });
    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/onramp/orders/:orderId", authenticate, requireRole("SUPER_ADMIN", "TREASURY", "ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const { crossmintService } = await import("../../services/crossmint.service");
    const orderId = req.params.orderId as string;
    const status = await crossmintService.getOrderStatus(orderId);
    res.json(status);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/offramp/orders", authenticate, requireRole("SUPER_ADMIN", "TREASURY", "ADMIN"), async (_req: AuthRequest, res: Response) => {
  try {
    const orders = await treasuryRampService.getOfframpOrders();
    res.json(orders);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/offramp/orders", authenticate, requireRole("SUPER_ADMIN", "TREASURY"), async (req: AuthRequest, res: Response) => {
  try {
    const { chain, amount, paymentMethodId, sourceWalletType } = req.body;
    if (!chain || !amount) {
      res.status(400).json({ error: "chain and amount are required" });
      return;
    }
    const result = await treasuryRampService.createOfframpOrder({
      chain,
      amount,
      paymentMethodId,
      sourceWalletType,
      createdBy: req.userId || "ADMIN",
    });
    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/offramp/orders/:id/execute", authenticate, requireRole("SUPER_ADMIN", "TREASURY"), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const result = await treasuryRampService.executeOfframpOrder(id);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/offramp/orders/:id/confirm", authenticate, requireRole("SUPER_ADMIN", "TREASURY"), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { txHash } = req.body;
    if (!txHash) {
      res.status(400).json({ error: "txHash is required" });
      return;
    }
    await treasuryRampService.confirmOfframpOrder(id, txHash);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/bank-accounts", authenticate, requireRole("SUPER_ADMIN", "TREASURY", "ADMIN"), async (_req: AuthRequest, res: Response) => {
  try {
    const accounts = await treasuryRampService.listBankAccounts();
    res.json(accounts);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/bank-accounts", authenticate, requireRole("SUPER_ADMIN", "TREASURY"), async (req: AuthRequest, res: Response) => {
  try {
    const { bankName, accountSuffix, routingNumber, paymentMethodId, currency, isDefault } = req.body;
    if (!bankName || !paymentMethodId) {
      res.status(400).json({ error: "bankName and paymentMethodId are required" });
      return;
    }
    const account = await treasuryRampService.addBankAccount({ bankName, accountSuffix, routingNumber, paymentMethodId, currency, isDefault });
    res.status(201).json(account);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.delete("/bank-accounts/:id", authenticate, requireRole("SUPER_ADMIN", "TREASURY"), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const result = await treasuryRampService.removeBankAccount(id);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export { router as treasuryRampRoutes };
