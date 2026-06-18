import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { fxService } from "../fx/fx.service";
import { feeService } from "../fees/fee.service";

const router = Router();

const quoteSchema = z.object({
  amount: z.number().positive(),
  currency: z.string(),
  country: z.string(),
  method: z.enum(["BANK", "MOBILE_MONEY", "CASH_PICKUP"]),
});

router.post("/quote", authenticate, async (req: AuthRequest, res: Response) => {
  const data = quoteSchema.parse(req.body);

  const fxRate = await fxService.getRate("USDT", data.currency);
  const { fee } = await feeService.calculate(data.country, data.method, data.amount);
  const destinationAmount = (data.amount - fee) * fxRate;

  res.json({
    amount: data.amount,
    fee,
    fxRate,
    destinationAmount,
  });
});

export { router as quoteRoutes };
