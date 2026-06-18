export class RoutingService {
  resolve(transfer: { payoutMethod: string }) {
    switch (transfer.payoutMethod) {
      case "BANK":
        return { name: "BANK_PARTNER_A" };
      case "MOBILE_MONEY":
        return { name: "MOBILE_MONEY_PARTNER_B" };
      case "CASH_PICKUP":
        return { name: "CASH_NETWORK_C" };
      default:
        return { name: "DEFAULT_PARTNER" };
    }
  }
}
