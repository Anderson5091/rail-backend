import { z } from "zod";
import { Router, Response } from "express";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { idempotencyMiddleware } from "../../middleware/idempotency.middleware";
import { fxService } from "../fx/fx.service";
import { feeService } from "../fees/fee.service";
import { TransferOrchestrator } from "./transfer.orchestrator";
import { ENV } from "../../config/env";

const router = Router();

const createSchema = z.object({
  beneficiaryId: z.string(),
  amount: z.number().positive(),
  payoutMethod: z.string().optional(),
  accountCurrency: z.string().optional(),
});

const orchestrator = new TransferOrchestrator();

router.post("/quote", async (req: AuthRequest, res: Response) => {
  const { amount, currency, country, method, accountCurrency } = req.body;
  const destCurrency = currency || await fxService.resolveCurrency(country, method, accountCurrency);
  const fxRate = await fxService.getRate(ENV.APP_CURRENCY_TOKEN, destCurrency);
  const { fee } = await feeService.calculate(country, method, amount);
  const destinationAmount = (amount - fee) * fxRate;

  res.json({ amount, fee, fxRate, destinationAmount, currency: destCurrency });
});

router.post("/", authenticate, idempotencyMiddleware, async (req: AuthRequest, res: Response) => {
  const data = createSchema.parse(req.body);
  const beneficiary = await prisma.beneficiary.findUnique({ where: { id: data.beneficiaryId } });
  const payOutMethod = beneficiary?.payoutMethod || data.payoutMethod || "BANK";
  const currency = await fxService.resolveCurrency(
    beneficiary?.country || "US",
    payOutMethod,
    data.accountCurrency || beneficiary?.accountCurrency,
  );
  const transfer = await orchestrator.createTransfer({
    ...data,
    payoutMethod: payOutMethod,
    currency,
    userId: req.userId!,
    country: beneficiary?.country,
  });
  res.status(201).json(transfer);
});

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  const transfers = await prisma.transfer.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(transfers);
});

router.get("/:id", authenticate, async (req: AuthRequest, res: Response) => {
  const transfer = await prisma.transfer.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { payoutOrder: true },
  });
  if (!transfer) return res.status(404).json({ error: "Transfer not found" });

  let beneficiary = null;
  if (transfer.beneficiaryId) {
    beneficiary = await prisma.beneficiary.findUnique({ where: { id: transfer.beneficiaryId } });
  }

  res.json({
    ...transfer,
    amount: Number(transfer.amount),
    fee: transfer.fee ? Number(transfer.fee) : null,
    fxRate: transfer.fxRate ? Number(transfer.fxRate) : null,
    destinationAmount: transfer.destinationAmount ? Number(transfer.destinationAmount) : null,
    beneficiary: beneficiary ? {
      fullName: beneficiary.fullName,
      country: beneficiary.country,
      payoutMethod: beneficiary.payoutMethod,
      bankName: (beneficiary as any).bankName || null,
      accountNumber: (beneficiary as any).accountNumber || null,
    } : null,
  });
});

export { router as transferRoutes };
