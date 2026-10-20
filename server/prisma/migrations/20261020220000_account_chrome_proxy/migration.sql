-- Persist each cashier's Chrome proxy on the account row.

ALTER TABLE "accounts" ADD COLUMN "chrome_proxy" TEXT;
