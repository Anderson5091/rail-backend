import { partnerRepository } from "../registry/partner.repository";

interface PayoutRequest {
  payoutMethod: string;
  amount: number;
  country?: string;
}

interface RoutingResult {
  partner: { id: string; name: string; type: string; baseUrl?: string };
  adapterType: string;
}

export class PartnerRouterService {
  async route(request: PayoutRequest): Promise<RoutingResult> {
    const partners = await partnerRepository.findActiveByType(request.payoutMethod);

    if (partners.length === 0) {
      throw new Error(`No active partner found for method: ${request.payoutMethod}`);
    }

    const partner = partners[0];

    return {
      partner: {
        id: partner.id,
        name: partner.name,
        type: partner.type,
        baseUrl: partner.baseUrl || undefined,
      },
      adapterType: partner.type,
    };
  }

  async routeWithFallback(request: PayoutRequest): Promise<RoutingResult> {
    const partners = await partnerRepository.findActiveByType(request.payoutMethod);

    if (partners.length === 0) {
      throw new Error(`No active partner found for method: ${request.payoutMethod}`);
    }

    const preferred = partners[0];
    const fallbacks = partners.slice(1);

    return {
      partner: {
        id: preferred.id,
        name: preferred.name,
        type: preferred.type,
        baseUrl: preferred.baseUrl || undefined,
      },
      adapterType: preferred.type,
    };
  }

  getFallbacks(partners: { id: string; name: string; type: string; baseUrl?: string }[], currentPartnerId: string) {
    return partners.filter((p) => p.id !== currentPartnerId);
  }
}

export const partnerRouterService = new PartnerRouterService();
