import { Router, Request, Response } from "express";
import { optionalAuth, authenticate, AuthRequest } from "../../middleware/auth";
import { feeService } from "./fee.service";

const router = Router();

router.get("/estimate", optionalAuth, async (req: Request, res: Response) => {
  const { transactionType, amount: amountStr } = req.query;
  if (!transactionType || !amountStr) {
    return res.status(400).json({ error: "transactionType and amount are required" });
  }
  const amount = parseFloat(amountStr as string);
  if (isNaN(amount) || amount < 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }
  const result = await feeService.calculateByTransactionType(transactionType as string, amount);
  res.json(result);
});

router.get("/config/:transactionType", optionalAuth, async (req: Request, res: Response) => {
  const config = await feeService.getConfig(req.params.transactionType as string);
  if (!config) {
    return res.status(404).json({ error: "Fee config not found" });
  }
  res.json({
    transactionType: config.transactionType,
    label: config.label,
    systemFeeEnabled: config.systemFeeEnabled,
    systemFeeMode: config.systemFeeMode,
    systemFixedFee: Number(config.systemFixedFee),
    systemPercentFee: Number(config.systemPercentFee),
    processingFeeEnabled: config.processingFeeEnabled,
    processingFeeMode: config.processingFeeMode,
    processingFixedFee: Number(config.processingFixedFee),
    processingPercentFee: Number(config.processingPercentFee),
  });
});

export { router as publicFeeRoutes };
