import axios from "axios";
import { ENV } from "../../config/env";
import { logger } from "../../utils/logger";

const client = axios.create({
  baseURL: ENV.DIDIT_API_BASE_URL,
  headers: { "x-api-key": ENV.DIDIT_API_KEY, "Content-Type": "application/json" },
  timeout: 30000,
});

interface DiditIdResult {
  status: string;
  document_type?: string;
  document_number?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  date_of_birth?: string;
  issuing_state?: string;
  nationality?: string;
  address?: string;
  expiry_date?: string;
  score?: number;
  warnings?: Array<{ risk: string; short_description: string; log_type: string }>;
}

interface DiditLivenessResult {
  status: string;
  score?: number;
  method?: string;
  warnings?: Array<{ risk: string; short_description: string }>;
}

interface DiditFaceMatchResult {
  status: string;
  score?: number;
  warnings?: Array<{ risk: string; short_description: string }>;
}

interface DiditPoaResult {
  status: string;
  document_type?: string;
  poa_address?: string;
  poa_formatted_address?: string;
  issuing_state?: string;
  name_on_document?: string;
  warnings?: Array<{ risk: string; short_description: string }>;
}

interface DiditAmlResult {
  status: string;
  total_hits?: number;
  score?: number;
  entity_type?: string;
  hits?: Array<{ list_name: string; match_name: string; category: string }>;
  warnings?: Array<{ risk: string; short_description: string }>;
}

interface DiditDbValidationResult {
  status: string;
  score?: number;
  match_rate?: number;
  warnings?: Array<{ risk: string; short_description: string }>;
}

class DiditService {
  private async post<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    try {
      const { data } = await client.post<T>(path, payload);
      return data;
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.response?.data || err.message;
      logger.error(`[Didit] ${path} failed (${status}):`, detail);
      throw new Error(`Didit ${path} failed: ${JSON.stringify(detail)}`);
    }
  }

  async verifyId(imageBase64: string): Promise<DiditIdResult> {
    return this.post<DiditIdResult>("/id-verification/", {
      image: imageBase64,
    });
  }

  async passiveLiveness(imageBase64: string): Promise<DiditLivenessResult> {
    return this.post<DiditLivenessResult>("/passive-liveness/", {
      image: imageBase64,
    });
  }

  async faceMatch(
    selfieBase64: string,
    idPortraitBase64: string
  ): Promise<DiditFaceMatchResult> {
    return this.post<DiditFaceMatchResult>("/face-match/", {
      image_1: selfieBase64,
      image_2: idPortraitBase64,
    });
  }

  async verifyProofOfAddress(imageBase64: string): Promise<DiditPoaResult> {
    return this.post<DiditPoaResult>("/poa/", {
      image: imageBase64,
    });
  }

  async amlScreen(params: {
    first_name: string;
    last_name: string;
    date_of_birth?: string;
    nationality?: string;
    country?: string;
  }): Promise<DiditAmlResult> {
    return this.post<DiditAmlResult>("/aml/", params);
  }

  async databaseValidation(params: {
    first_name: string;
    last_name: string;
    date_of_birth: string;
    country: string;
  }): Promise<DiditDbValidationResult> {
    return this.post<DiditDbValidationResult>("/database-validation/", params);
  }
}

export const diditService = new DiditService();
