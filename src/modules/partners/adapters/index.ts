import { BasePartnerAdapter } from "./base.adapter";
import { BankAdapter } from "./bank.adapter";
import { MobileMoneyAdapter } from "./mobile-money.adapter";
import { CashPickupAdapter } from "./cash.adapter";

type AdapterType = "BANK" | "MOBILE_MONEY" | "CASH_PICKUP";

const adapterRegistry: Record<string, BasePartnerAdapter> = {
  BANK: new BankAdapter(),
  MOBILE_MONEY: new MobileMoneyAdapter(),
  CASH_PICKUP: new CashPickupAdapter(),
};

export function getAdapter(type: string): BasePartnerAdapter {
  const adapter = adapterRegistry[type];
  if (!adapter) {
    throw new Error(`No adapter found for type: ${type}`);
  }
  return adapter;
}

export { BasePartnerAdapter, BankAdapter, MobileMoneyAdapter, CashPickupAdapter };
