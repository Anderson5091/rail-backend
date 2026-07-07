import { prisma } from "../../config/database";
import { diditService } from "./didit.service";
import { logger } from "../../utils/logger";
import { AppError } from "../../middleware/errorHandler";

export interface Tier1Input {
  fullName: string;
  dateOfBirth: string;
  nationality: string;
  country: string;
  address: string;
}

export interface Tier2Input {
  idImage: string;
  selfieImage: string;
  documentType: string;
}

export interface Tier3Input {
  poaImage: string;
  sourceOfFunds?: string;
}

export interface KycStatusResult {
  profile: any;
  userTier: number;
  userStatus: string;
  nextTier: number | null;
  limits: TierLimits;
  lastEvent: any;
}

export interface TierLimits {
  dailySend: number;
  monthlySend: number;
}

const TIER_LIMITS: Record<number, TierLimits> = {
  0: { dailySend: 0, monthlySend: 0 },
  1: { dailySend: 100, monthlySend: 500 },
  2: { dailySend: 500, monthlySend: 5000 },
  3: { dailySend: 5000, monthlySend: 50000 },
};

class KycService {
  getLimits(tier: number): TierLimits {
    return TIER_LIMITS[tier] ?? TIER_LIMITS[0];
  }

  async processTier1(userId: string, input: Tier1Input): Promise<{ status: string; tier: number; details: any }> {
    const nameParts = input.fullName.trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || firstName;

    const [amlResult, dbResult] = await Promise.all([
      diditService.amlScreen({
        first_name: firstName,
        last_name: lastName,
        date_of_birth: input.dateOfBirth,
        nationality: input.nationality,
        country: input.country,
      }),
      diditService.databaseValidation({
        first_name: firstName,
        last_name: lastName,
        date_of_birth: input.dateOfBirth,
        country: input.country,
      }).catch(() => ({ status: "Skipped", score: 0, match_rate: 0 })),
    ]);

    const amlFlagged = (amlResult.total_hits ?? 0) > 0;
    const dbMatchRate = dbResult.match_rate ?? 0;
    const dbFailed = dbResult.status === "Declined" || dbMatchRate < 50;

    let status = "APPROVED";
    let tier = 1;
    if (amlFlagged) {
      status = "IN_REVIEW";
    }
    if (dbFailed && !amlFlagged) {
      status = "PENDING_REVIEW";
    }

    const profile = await prisma.kycProfile.upsert({
      where: { userId },
      create: {
        userId,
        fullName: input.fullName,
        dateOfBirth: input.dateOfBirth,
        nationality: input.nationality,
        country: input.country,
        address: input.address,
        tier,
        status,
      },
      update: {
        fullName: input.fullName,
        dateOfBirth: input.dateOfBirth,
        nationality: input.nationality,
        country: input.country,
        address: input.address,
        tier,
        status,
      },
    });

    await prisma.kycEvent.create({
      data: {
        userId,
        eventType: "TIER1_SUBMIT",
        status,
        provider: "didit",
        rawPayload: { aml: amlResult, database: dbResult, input },
      },
    });

    if (status === "APPROVED") {
      await prisma.user.update({
        where: { id: userId },
        data: { kycTier: 1, kycStatus: "approved" },
      });
    } else {
      await prisma.user.update({
        where: { id: userId },
        data: { kycStatus: status === "IN_REVIEW" ? "in_review" : "pending" },
      });
    }

    logger.info(`[KYC] Tier 1 for user ${userId}: ${status}`);
    return { status, tier, details: { aml: amlResult, database: dbResult } };
  }

  async processTier2(userId: string, input: Tier2Input): Promise<{ status: string; tier: number; details: any }> {
    const profile = await prisma.kycProfile.findUnique({ where: { userId } });
    if (!profile) throw new AppError(400, "Submit Tier 1 before Tier 2");

    const [idResult, livenessResult] = await Promise.all([
      diditService.verifyId(input.idImage),
      diditService.passiveLiveness(input.selfieImage),
    ]);

    const faceMatchResult = idResult?.document_type
      ? await diditService.faceMatch(input.selfieImage, input.idImage).catch(() => null)
      : null;

    const idApproved = idResult.status === "Approved";
    const livenessApproved = livenessResult.status === "Approved" && (livenessResult.score ?? 0) >= 70;
    const faceMatchApproved = !faceMatchResult || (faceMatchResult.score ?? 0) >= 70;

    const allPassed = idApproved && livenessApproved && faceMatchApproved;
    const status = allPassed ? "APPROVED" : "DECLINED";

    await prisma.kycProfile.update({
      where: { userId },
      data: {
        status,
        tier: status === "APPROVED" ? 2 : profile.tier,
        selfieUrl: input.selfieImage?.slice(0, 500),
        diditVerificationId: idResult.document_number || null,
      },
    });

    await prisma.kycEvent.create({
      data: {
        userId,
        eventType: "TIER2_SUBMIT",
        status,
        provider: "didit",
        rawPayload: { idVerification: idResult, liveness: livenessResult, faceMatch: faceMatchResult },
      },
    });

    if (status === "APPROVED") {
      await prisma.user.update({
        where: { id: userId },
        data: { kycTier: 2, kycStatus: "approved" },
      });
    }

    logger.info(`[KYC] Tier 2 for user ${userId}: ${status}`);
    return { status, tier: status === "APPROVED" ? 2 : 1, details: { idVerification: idResult, liveness: livenessResult, faceMatch: faceMatchResult } };
  }

  async processTier3(userId: string, input: Tier3Input): Promise<{ status: string; tier: number; details: any }> {
    const profile = await prisma.kycProfile.findUnique({ where: { userId } });
    if (!profile || (profile.tier ?? 0) < 2) throw new AppError(400, "Complete Tier 2 before Tier 3");

    const poaResult = await diditService.verifyProofOfAddress(input.poaImage);
    const poaApproved = poaResult.status === "Approved";

    const status = poaApproved ? "APPROVED" : "DECLINED";

    await prisma.kycProfile.update({
      where: { userId },
      data: {
        status,
        tier: 3,
        address: poaResult.poa_formatted_address || profile.address,
      },
    });

    await prisma.kycEvent.create({
      data: {
        userId,
        eventType: "TIER3_SUBMIT",
        status,
        provider: "didit",
        rawPayload: { poa: poaResult, sourceOfFunds: input.sourceOfFunds },
      },
    });

    if (status === "APPROVED") {
      await prisma.user.update({
        where: { id: userId },
        data: { kycTier: 3, kycStatus: "approved" },
      });
    }

    logger.info(`[KYC] Tier 3 for user ${userId}: ${status}`);
    return { status, tier: 3, details: { poa: poaResult } };
  }

  async getStatus(userId: string): Promise<KycStatusResult> {
    const [user, profile, lastEvent] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { kycTier: true, kycStatus: true },
      }),
      prisma.kycProfile.findUnique({ where: { userId } }),
      prisma.kycEvent.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const currentTier = user?.kycTier ?? 0;
    const nextTier = currentTier < 3 ? currentTier + 1 : null;

    return {
      profile,
      userTier: currentTier,
      userStatus: user?.kycStatus ?? "none",
      nextTier,
      limits: this.getLimits(currentTier),
      lastEvent,
    };
  }
}

export const kycService = new KycService();
