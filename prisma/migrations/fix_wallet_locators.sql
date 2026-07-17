-- Fix existing treasury wallet locators: replace me: prefixed alias locators
-- with the wallet's blockchain address (compatible with server-side API keys)
UPDATE "TreasuryWallet" SET "walletLocator" = address WHERE "walletLocator" LIKE 'me:%';
