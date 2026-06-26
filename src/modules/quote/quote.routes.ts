import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { fxService } from "../fx/fx.service";
import { feeService } from "../fees/fee.service";

const router = Router();

const quoteSchema = z.object({
  amount: z.number().positive(),
  country: z.string(),
  method: z.enum(["BANK", "MOBILE_MONEY", "CASH_PICKUP"]),
  accountCurrency: z.string().optional(),
});

router.post("/quote", authenticate, async (req: AuthRequest, res: Response) => {
  const data = quoteSchema.parse(req.body);

  const currency = await fxService.resolveCurrency(data.country, data.method, data.accountCurrency);
  const fxRate = await fxService.getRate("USDT", currency);
  const { fee } = await feeService.calculate(data.country, data.method, data.amount);
  const destinationAmount = (data.amount - fee) * fxRate;

  res.json({
    amount: data.amount,
    fee,
    fxRate,
    destinationAmount,
    currency,
  });
});

export { router as quoteRoutes };
