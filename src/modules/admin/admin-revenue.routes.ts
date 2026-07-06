import { Router, Response } from "express";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest, requireRole } from "../../middleware/auth";

const router = Router();

function getPeriodRange(period: string, from?: string, to?: string) {
  const now = new Date();
  let start: Date;
  if (from) {
    start = new Date(from);
  } else {
    switch (period) {
      case "year":
        start = new Date(now.getFullYear(), 0, 1);
        break;
      case "month":
        start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        break;
      default:
        start = new Date(now);
        start.setDate(start.getDate() - 30);
        break;
    }
  }
  const end = to ? new Date(to) : now;
  return { start, end };
}

function keyFn(d: Date, step: string) {
  return step === "month" ? d.toISOString().slice(0, 7) : d.toISOString().slice(0, 10);
}

router.get("/system", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "TREASURY"), async (req: AuthRequest, res: Response) => {
  const period = (req.query.period as string) || "day";
  const { start, end } = getPeriodRange(period, req.query.from as string, req.query.to as string);

  const feeFilter = { fee: { gt: 0 } };

  const [allTransfer, allDeposit, allWithdrawal] = await Promise.all([
    prisma.transfer.aggregate({ _sum: { fee: true }, where: { ...feeFilter, status: { notIn: ["DRAFT", "FAILED", "CANCELLED"] } } }),
    prisma.depositRequest.aggregate({ _sum: { fee: true }, where: { ...feeFilter, status: { in: ["APPROVED", "COMPLETED", "SWEPT"] } } }),
    prisma.withdrawal.aggregate({ _sum: { fee: true }, where: { ...feeFilter, status: "COMPLETED" } }),
  ]);

  const periodFeeFilter = { fee: { gt: 0 }, createdAt: { gte: start, lte: end } };

  const [periodTransfer, periodDeposit, periodWithdrawal] = await Promise.all([
    prisma.transfer.aggregate({ _sum: { fee: true }, where: { ...periodFeeFilter, status: { notIn: ["DRAFT", "FAILED", "CANCELLED"] } } }),
    prisma.depositRequest.aggregate({ _sum: { fee: true }, where: { ...periodFeeFilter, status: { in: ["APPROVED", "COMPLETED", "SWEPT"] } } }),
    prisma.withdrawal.aggregate({ _sum: { fee: true }, where: { ...periodFeeFilter, status: "COMPLETED" } }),
  ]);

  const step = period === "day" ? "day" : "month";
  const fn = (d: Date) => keyFn(d, step);

  const [transferByPeriod, depositByPeriod, withdrawalByPeriod] = await Promise.all([
    prisma.transfer.groupBy({ by: ["createdAt"], _sum: { fee: true }, where: { ...periodFeeFilter, status: { notIn: ["DRAFT", "FAILED", "CANCELLED"] } } }),
    prisma.depositRequest.groupBy({ by: ["createdAt"], _sum: { fee: true }, where: { ...periodFeeFilter, status: { in: ["APPROVED", "COMPLETED", "SWEPT"] } } }),
    prisma.withdrawal.groupBy({ by: ["createdAt"], _sum: { fee: true }, where: { ...periodFeeFilter, status: "COMPLETED" } }),
  ]);

  const trendMap = new Map<string, { label: string; transfer: number; deposit: number; withdrawal: number; total: number }>();

  for (const r of transferByPeriod) {
    const k = fn(r.createdAt);
    if (!trendMap.has(k)) trendMap.set(k, { label: k, transfer: 0, deposit: 0, withdrawal: 0, total: 0 });
    trendMap.get(k)!.transfer += Number(r._sum.fee || 0);
  }
  for (const r of depositByPeriod) {
    const k = fn(r.createdAt);
    if (!trendMap.has(k)) trendMap.set(k, { label: k, transfer: 0, deposit: 0, withdrawal: 0, total: 0 });
    trendMap.get(k)!.deposit += Number(r._sum.fee || 0);
  }
  for (const r of withdrawalByPeriod) {
    const k = fn(r.createdAt);
    if (!trendMap.has(k)) trendMap.set(k, { label: k, transfer: 0, deposit: 0, withdrawal: 0, total: 0 });
    trendMap.get(k)!.withdrawal += Number(r._sum.fee || 0);
  }

  for (const entry of trendMap.values()) {
    entry.total = entry.transfer + entry.deposit + entry.withdrawal;
  }

  const trend = Array.from(trendMap.values()).sort((a, b) => a.label.localeCompare(b.label));

  const allTimeTotal = Number(allTransfer._sum.fee || 0) + Number(allDeposit._sum.fee || 0) + Number(allWithdrawal._sum.fee || 0);
  const periodTotal = Number(periodTransfer._sum.fee || 0) + Number(periodDeposit._sum.fee || 0) + Number(periodWithdrawal._sum.fee || 0);

  res.json({
    allTimeTotal,
    allTimeBreakdown: {
      transferFees: Number(allTransfer._sum.fee || 0),
      depositFees: Number(allDeposit._sum.fee || 0),
      withdrawalFees: Number(allWithdrawal._sum.fee || 0),
    },
    total: periodTotal,
    breakdown: {
      transferFees: Number(periodTransfer._sum.fee || 0),
      depositFees: Number(periodDeposit._sum.fee || 0),
      withdrawalFees: Number(periodWithdrawal._sum.fee || 0),
    },
    period,
    start: start.toISOString(),
    end: end.toISOString(),
    trend,
  });
});

router.get("/agents", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "TREASURY"), async (req: AuthRequest, res: Response) => {
  const period = (req.query.period as string) || "day";
  const agentId = req.query.agentId as string | undefined;
  const { start, end } = getPeriodRange(period, req.query.from as string, req.query.to as string);
  const filter = agentId ? { agentId } : {};

  const [allCommissions, allKpi] = await Promise.all([
    prisma.agentTransaction.aggregate({ _sum: { commission: true }, where: { ...filter, commission: { gt: 0 }, status: "COMPLETED" } }),
    prisma.agentKpi.aggregate({ _sum: { totalCommission: true }, where: { ...filter } }),
  ]);

  const [periodCommissions, periodKpi] = await Promise.all([
    prisma.agentTransaction.aggregate({ _sum: { commission: true }, where: { ...filter, commission: { gt: 0 }, createdAt: { gte: start, lte: end }, status: "COMPLETED" } }),
    prisma.agentKpi.aggregate({ _sum: { totalCommission: true }, where: { ...filter, periodEnd: { gte: start, lte: end } } }),
  ]);

  const step = period === "day" ? "day" : "month";
  const fn = (d: Date) => keyFn(d, step);

  const [commByPeriod, kpiByPeriod] = await Promise.all([
    prisma.agentTransaction.groupBy({ by: ["createdAt"], _sum: { commission: true }, where: { ...filter, commission: { gt: 0 }, createdAt: { gte: start, lte: end }, status: "COMPLETED" } }),
    prisma.agentKpi.groupBy({ by: ["periodEnd"], _sum: { totalCommission: true }, where: { ...filter, periodEnd: { gte: start, lte: end } } }),
  ]);

  const trendMap = new Map<string, { label: string; commissions: number; kpiRewards: number; total: number }>();

  for (const r of commByPeriod) {
    const k = fn(r.createdAt);
    if (!trendMap.has(k)) trendMap.set(k, { label: k, commissions: 0, kpiRewards: 0, total: 0 });
    trendMap.get(k)!.commissions += Number(r._sum.commission || 0);
  }
  for (const r of kpiByPeriod) {
    const k = fn(r.periodEnd);
    if (!trendMap.has(k)) trendMap.set(k, { label: k, commissions: 0, kpiRewards: 0, total: 0 });
    trendMap.get(k)!.kpiRewards += Number(r._sum.totalCommission || 0);
  }
  for (const entry of trendMap.values()) {
    entry.total = entry.commissions + entry.kpiRewards;
  }

  const trend = Array.from(trendMap.values()).sort((a, b) => a.label.localeCompare(b.label));

  const allTimeTotal = Number(allCommissions._sum.commission || 0) + Number(allKpi._sum.totalCommission || 0);
  const periodTotal = Number(periodCommissions._sum.commission || 0) + Number(periodKpi._sum.totalCommission || 0);

  const agents = await prisma.agent.findMany({
    select: { id: true, fullName: true, email: true },
    orderBy: { fullName: "asc" },
  });

  res.json({
    allTimeTotal,
    allTimeBreakdown: {
      commissions: Number(allCommissions._sum.commission || 0),
      kpiRewards: Number(allKpi._sum.totalCommission || 0),
    },
    total: periodTotal,
    breakdown: {
      commissions: Number(periodCommissions._sum.commission || 0),
      kpiRewards: Number(periodKpi._sum.totalCommission || 0),
    },
    period,
    start: start.toISOString(),
    end: end.toISOString(),
    agentId: agentId || null,
    agents,
    trend,
  });
});

export { router as adminRevenueRoutes };
