export function extractBalance(balances: unknown, token: string): number {
  if (typeof balances !== "object" || balances === null) return 0;

  const record = balances as Record<string, unknown>;

  const tokensArray = record.tokens;
  if (Array.isArray(tokensArray)) {
    const match = tokensArray.find(
      (t: Record<string, unknown>) =>
        String(t.token || "").toLowerCase() === token.toLowerCase() ||
        String(t.symbol || "").toLowerCase() === token.toLowerCase()
    );
    if (match) return Number(match.amount ?? match.balance ?? 0) || 0;
  }

  const direct = record[token];
  if (direct != null) {
    if (typeof direct === "number") return direct;
    if (typeof direct === "string") return Number(direct) || 0;
    if (typeof direct === "object") {
      return Number((direct as Record<string, unknown>).amount) || 0;
    }
  }

  if (token.toLowerCase() === "native") {
    const native = record.nativeToken;
    if (native && typeof native === "object") {
      return Number((native as Record<string, unknown>).amount) || 0;
    }
  }

  return Number(record.balance) || 0;
}
