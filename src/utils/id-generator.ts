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

const PREFIX_MAP: Record<string, string> = {
  User: "QSU",
  Partner: "QSP",
};

const AGENT_TYPE_MAP: Record<string, string> = {
  INTERNAL: "QSIA",
  PARTNER: "QSPA",
};

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
