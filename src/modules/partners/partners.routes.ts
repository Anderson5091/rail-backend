import { z } from "zod";
import { Router, Response, Request } from "express";
import { authenticate, AuthRequest, requireRole } from "../../middleware/auth";
import { partnerService } from "./registry/partner.service";
import { partnerRouterService } from "./router/partner-router.service";
import { getAdapter } from "./adapters/index";
import { slaMonitorService } from "./sla/sla-monitor.service";
import { partnerReconciliationService } from "./reconciliation/reconciliation.service";
import { partnerRepository } from "./registry/partner.repository";
import { partnerWebhookController } from "./webhook/webhook.controller";
import { logger } from "../../utils/logger";

const router = Router();

const createPartnerSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["BANK", "MOBILE_MONEY", "CASH_PICKUP"]),
  country: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  priority: z.number().int().optional(),
});

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  const partners = await partnerService.listPartners();
  res.json(partners);
});

router.get("/:id", authenticate, async (req: AuthRequest, res: Response) => {
  const partner = await partnerService.getPartner(req.params.id as string);
  if (!partner) return res.status(404).json({ error: "Partner not found" });
  res.json(partner);
});

router.post("/", authenticate, requireRole("SUPER_ADMIN", "OPS"), async (req: AuthRequest, res: Response) => {
  const data = createPartnerSchema.parse(req.body);
  const partner = await partnerService.registerPartner(data);
  res.status(201).json(partner);
});

router.put("/:id", authenticate, requireRole("SUPER_ADMIN", "OPS"), async (req: AuthRequest, res: Response) => {
  const partner = await partnerService.updatePartner(req.params.id as string, req.body);
  res.json(partner);
});

router.delete("/:id", authenticate, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  await partnerService.deactivatePartner(req.params.id as string);
  res.json({ success: true });
});

router.get("/:id/transactions", authenticate, async (req: AuthRequest, res: Response) => {
  const transactions = await partnerService.getPartnerTransactions(req.params.id as string);
  res.json(transactions);
});

router.get("/:id/metrics", authenticate, async (req: AuthRequest, res: Response) => {
  const metrics = await slaMonitorService.getMetrics(req.params.id as string);
  res.json(metrics);
});

const simulatePayoutSchema = z.object({
  payoutMethod: z.string(),
  amount: z.number().positive(),
  beneficiaryName: z.string().optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  phoneNumber: z.string().optional(),
  provider: z.string().optional(),
  location: z.string().optional(),
  recipientName: z.string().optional(),
});

router.post("/route", authenticate, async (req: AuthRequest, res: Response) => {
  const data = simulatePayoutSchema.parse(req.body);
  const routing = await partnerRouterService.route({ payoutMethod: data.payoutMethod, amount: data.amount });
  const adapter = getAdapter(routing.adapterType);
  const start = Date.now();

  try {
    const response = await adapter.sendPayout({ ...data, reference: `SIM-${Date.now()}` });
    const elapsed = Date.now() - start;
    await slaMonitorService.recordSuccess(routing.partner.id, elapsed);

    await partnerRepository.createTransaction({
      transferId: `sim_${Date.now()}`,
      partnerId: routing.partner.id,
      externalReference: response.externalReference,
      status: response.status,
      requestPayload: data as any,
      responsePayload: response as any,
    });

    res.json({ routing, response });
  } catch (error) {
    const elapsed = Date.now() - start;
    await slaMonitorService.recordFailure(routing.partner.id, elapsed);
    logger.error(`[PARTNER_ROUTE] Payout to ${routing.partner.name} failed`, error);
    res.status(500).json({ error: "Payout failed", routing });
  }
});

router.post("/reconcile", authenticate, requireRole("SUPER_ADMIN", "OPS"), async (req: AuthRequest, res: Response) => {
  const result = await partnerReconciliationService.reconcile();
  res.json(result);
});

router.post("/webhook/:partnerId", async (req: AuthRequest, res: Response) => {
  await partnerWebhookController.receive(req, res);
});

export { router as partnerRoutes };
