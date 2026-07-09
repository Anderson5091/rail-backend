import crypto from "node:crypto";

const ALPHANUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function rand(length: number): string {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += ALPHANUM[bytes[i] % ALPHANUM.length];
  }
  return result;
}

function agentPrefix(data: any): string {
  if (data?.type === "INTERNAL") return "QSIA";
  if (data?.type === "PARTNER") return "QSPA";
  return "QSA";
}

const ADMIN_ROLE_MAP: Record<string, string> = {
  SUPER_ADMIN: "QS-SAD",
  OPS: "QS-OPS",
  TREASURY: "QS-TRE",
  COMPLIANCE: "QS-COM",
};

function adminPrefix(data: any): string {
  const role = data?.role;
  return ADMIN_ROLE_MAP[role] || "QS-ADM";
}

export function generateModelId(model: string, data?: any): string | null {
  switch (model) {
    case "User":
      return `QSU${rand(14)}`;
    case "Agent": {
      const p = agentPrefix(data);
      return `${p}-${rand(14)}`;
    }
    case "AdminUser": {
      const p = adminPrefix(data);
      return `${p}-${rand(6)}`;
    }
    case "Partner":
      return `QSP${rand(14)}`;
    case "Wallet":
      return `QSW${rand(14)}`;
    case "WalletAddress":
      return `QSWA${rand(14)}`;
    case "WalletTransaction":
      return `QSWT${rand(14)}`;
    case "LedgerEntry":
      return `QSLE${rand(14)}`;
    case "OtpCode":
      return `QSOTP${rand(14)}`;
    case "Beneficiary":
      return `QSB${rand(14)}`;
    case "FxRate":
      return `QSFR${rand(14)}`;
    case "FeeRule":
      return `QSFE${rand(14)}`;
    case "Transfer":
      return `QSTR${rand(14)}`;
    case "PayoutOrder":
      return `QSPO${rand(14)}`;
    case "PayoutEvent":
      return `QSPE${rand(14)}`;
    case "PartnerLog":
      return `QSPLG${rand(14)}`;
    case "TreasuryWallet":
      return `QSTW${rand(14)}`;
    case "TreasuryMovement":
      return `QSTM${rand(14)}`;
    case "LiquiditySnapshot":
      return `QSLS${rand(14)}`;
    case "DepositRequest":
      return `QSDR${rand(14)}`;
    case "DepositWallet":
      return `QSDW${rand(14)}`;
    case "Withdrawal":
      return `QSWD${rand(14)}`;
    case "KycProfile":
      return `QSKP${rand(14)}`;
    case "KycDocument":
      return `QSKD${rand(14)}`;
    case "AmlCheck":
      return `QSAC${rand(14)}`;
    case "SanctionsHit":
      return `QSSH${rand(14)}`;
    case "ComplianceCase":
      return `QSCC${rand(14)}`;
    case "RiskScore":
      return `QSRS${rand(14)}`;
    case "Event":
      return `QSEV${rand(14)}`;
    case "Notification":
      return `QSN${rand(14)}`;
    case "NotificationDelivery":
      return `QSND${rand(14)}`;
    case "EventLog":
      return `QSEL${rand(14)}`;
    case "PartnerTransaction":
      return `QSPT${rand(14)}`;
    case "PartnerWebhook":
      return `QSPW${rand(14)}`;
    case "PartnerSlaMetric":
      return `QSPS${rand(14)}`;
    case "AgentLedgerEntry":
      return `QSALE${rand(14)}`;
    case "AgentWallet":
      return `QSAW${rand(14)}`;
    case "AgentTransaction":
      return `QSAT${rand(14)}`;
    case "AgentKpi":
      return `QSAK${rand(14)}`;
    case "AgentCashRequest":
      return `QSACR${rand(14)}`;
    case "AgentSettlement":
      return `QSAS${rand(14)}`;
    case "KycEvent":
      return `QSKE${rand(14)}`;
    case "AdminActionLog":
      return `QSAL${rand(14)}`;
    case "SystemAlert":
      return `QSSA${rand(14)}`;
    default:
      return null;
  }
}

export function generateTransactionNumber(): string {
  return `QSTx-${rand(14)}`;
}

export function generateReferenceNumber(): string {
  return `QSR-${rand(4)}-${rand(12)}`;
}

export function generatePartnerId(): string {
  return `QSP${rand(14)}`;
}
