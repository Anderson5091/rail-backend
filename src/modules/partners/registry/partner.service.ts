import { partnerRepository } from "./partner.repository";

export class PartnerService {
  async listPartners() {
    return partnerRepository.findAll();
  }

  async getPartner(id: string) {
    return partnerRepository.findById(id);
  }

  async registerPartner(data: { name: string; type: string; country?: string; baseUrl?: string; apiKey?: string; priority?: number }) {
    return partnerRepository.create(data);
  }

  async updatePartner(id: string, data: { name?: string; type?: string; country?: string; baseUrl?: string; apiKey?: string; priority?: number; status?: string }) {
    return partnerRepository.update(id, data);
  }

  async deactivatePartner(id: string) {
    return partnerRepository.remove(id);
  }

  async getPartnerTransactions(partnerId: string) {
    return partnerRepository.findTransactionsByPartner(partnerId);
  }
}

export const partnerService = new PartnerService();
