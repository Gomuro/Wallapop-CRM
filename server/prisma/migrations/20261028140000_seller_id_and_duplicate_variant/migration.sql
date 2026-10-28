-- Add-only: no rename, no drop, no existing data changes.

-- Public Wallapop seller id per account, and the cents a duplicate price ends in
-- on that account (98 for the second account; a third gets another ending).
ALTER TABLE "accounts"
  ADD COLUMN "wallapop_user_id" TEXT,
  ADD COLUMN "price_ending" INTEGER NOT NULL DEFAULT 98;

-- A duplicate (non-default account) waits here until its own text is saved.
-- Autopost only picks READY_TO_POST, so PREPARING rows are skipped as they are.
ALTER TYPE "ListingStatus" ADD VALUE IF NOT EXISTS 'PREPARING' AFTER 'READY_TO_POST';

-- Duplicate ad text and price for a listing on a non-default account,
-- plus the background retry schedule while it is PREPARING.
ALTER TABLE "product_listings"
  ADD COLUMN "variant_title" TEXT,
  ADD COLUMN "variant_description" TEXT,
  ADD COLUMN "variant_price" DECIMAL(10,2),
  ADD COLUMN "variant_source" TEXT,
  ADD COLUMN "variant_basis" TEXT,
  ADD COLUMN "variant_generated_at" TIMESTAMP(3),
  ADD COLUMN "variant_error" TEXT,
  ADD COLUMN "variant_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "variant_next_attempt_at" TIMESTAMP(3);
