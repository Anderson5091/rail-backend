import { prisma } from "../../../config/database";

const db = prisma as any;

export class PartnerRepository {
  async findAll() {
    return db.partner.findMany({ orderBy: [{ priority: "asc" }, { createdAt: "desc" }] });
  }

  async findActiveByType(type: string) {
    return db.partner.findMany({
      where: { type, status: "ACTIVE" },
      orderBy: { priority: "asc" },
    });
  }

  async findById(id: string) {
    return db.partner.findUnique({ where: { id } });
  }

  async create(data: { name: string; type: string; country?: string; baseUrl?: string; apiKey?: string; priority?: number }) {
    return db.partner.create({ data });
  }

  async update(id: string, data: { name?: string; type?: string; country?: string; baseUrl?: string; apiKey?: string; priority?: number; status?: string }) {
    return db.partner.update({ where: { id }, data });
  }

  async remove(id: string) {
    return db.partner.update({ where: { id }, data: { status: "INACTIVE" } });
  }

  async activate(id: string) {
    return db.partner.update({ where: { id }, data: { status: "ACTIVE" } });
  }

  async deletePartner(id: string) {
    return db.partner.update({
      where: { id },
      data: {
        name: "[Deleted Partner]",
        baseUrl: null,
        apiKey: null,
        status: "DELETED",
      },
    });
  }

  async createTransaction(data: { transferId: string; partnerId: string; externalReference?: string; status: string; requestPayload?: Record<string, unknown>; responsePayload?: Record<string, unknown> }) {
    return db.partnerTransaction.create({ data: data as any });
  }

  async findTransactionsByPartner(partnerId: string) {
    return db.partnerTransaction.findMany({ where: { partnerId }, orderBy: { createdAt: "desc" } });
  }

  async createWebhook(data: { partnerId: string; eventType: string; payload: Record<string, unknown> }) {
    return db.partnerWebhook.create({ data: data as any });
  }

  async getOrCreateSlaMetric(partnerId: string) {
    const existing = await db.partnerSlaMetric.findUnique({ where: { partnerId } });
    if (existing) return existing;
    return db.partnerSlaMetric.create({
      data: { partnerId, successRate: 100, avgResponseTimeMs: 0, failureCount: 0 },
    });
  }

  async updateSlaMetric(partnerId: string, data: { successRate?: number; avgResponseTimeMs?: number; failureCount?: number }) {
    return db.partnerSlaMetric.upsert({
      where: { partnerId },
      create: { partnerId, ...data },
      update: data,
    });
  }
}

export const partnerRepository = new PartnerRepository();
