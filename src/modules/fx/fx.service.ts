import { prisma } from "../../config/database";

export class FxService {
  async getRate(from: string, to: string): Promise<number> {
    const rate = await prisma.fxRate.findFirst({
      where: { fromCurrency: from, toCurrency: to },
    });

    if (rate) return Number(rate.rate);

    const rates: Record<string, Record<string, number>> = {
      USDT: { USD: 1, HTG: 135.25, MXN: 17.5, NGN: 1550, PHP: 56.2 },
    };

    return rates[from]?.[to] || 1;
  }
}

export const fxService = new FxService();
