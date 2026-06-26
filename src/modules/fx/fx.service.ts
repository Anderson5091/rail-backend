import { prisma } from "../../config/database";
import { ENV } from "../../config/env";

const FALLBACK_RATES: Record<string, Record<string, number>> = {
  USDT: { USD: 1, HTG: 135.25, MXN: 17.5, NGN: 1550, PHP: 56.2 },
};

const CACHE_TTL_MS = 5 * 60 * 1000;

const COUNTRY_CURRENCY: Record<string, string> = {
  HT: "HTG", DO: "DOP", MX: "MXN", NG: "NGN",
  PH: "PHP", KE: "KES", GH: "GHS", ZA: "ZAR",
  US: "USD", HTG: "HTG", MXN: "MXN", NGN: "NGN", PHP: "PHP",
};

export function getLocalCurrency(countryOrCode: string): string {
  return COUNTRY_CURRENCY[countryOrCode.toUpperCase()] || "USD";
}

export class FxService {
  async getRate(from: string, to: string): Promise<number> {
    if (from === to) return 1;

    const cached = await prisma.fxRate.findUnique({
      where: { fromCurrency_toCurrency: { fromCurrency: from, toCurrency: to } },
    });

    if (cached) {
      const age = Date.now() - cached.updatedAt.getTime();
      if (age < CACHE_TTL_MS) return Number(cached.rate);
    }

    try {
      const rate = await this.fetchRate(from, to);
      if (rate > 0) {
        await prisma.fxRate.upsert({
          where: { fromCurrency_toCurrency: { fromCurrency: from, toCurrency: to } },
          update: { rate, source: "allratestoday" },
          create: { fromCurrency: from, toCurrency: to, rate, source: "allratestoday" },
        });
        return rate;
      }
    } catch {
      if (cached) return Number(cached.rate);
    }

    return FALLBACK_RATES[from]?.[to] || 1;
  }

  private async fetchRate(from: string, to: string): Promise<number> {
    const url = `https://allratestoday.com/api/v1/rates?source=${from}&target=${to}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ENV.ART_API_KEY}` },
    });

    if (!res.ok) {
      throw new Error(`AllRatesToday API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { rate: number };
    return data.rate;
  }

  async resolveCurrency(country: string, payoutMethod: string, accountCurrency?: string | null): Promise<string> {
    if (payoutMethod === "CASH_PICKUP" || payoutMethod === "MOBILE_MONEY") {
      return getLocalCurrency(country);
    }
    return accountCurrency || getLocalCurrency(country) || "USD";
  }
}

export const fxService = new FxService();
