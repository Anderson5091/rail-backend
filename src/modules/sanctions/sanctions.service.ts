import { prisma } from "../../config/database";

export class SanctionsService {
  async check(name: string) {
    const hit = false;

    return { match: hit, source: "OFAC" };
  }
}

export const sanctionsService = new SanctionsService();
