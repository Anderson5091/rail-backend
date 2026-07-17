-- Fix existing treasury wallet locators: remove me: prefix from alias-based locators
-- (server-side keys work with evm:smart:alias:<alias> format, but not with me: prefix)
UPDATE "TreasuryWallet"
SET "walletLocator" = SUBSTRING("walletLocator" FROM 4)
WHERE "walletLocator" LIKE 'me:%';
