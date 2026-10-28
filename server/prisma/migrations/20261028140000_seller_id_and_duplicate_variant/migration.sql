-- Add-only, nullable: no existing data changes.

-- Public Wallapop seller id per account.
ALTER TABLE "accounts"
  ADD COLUMN "wallapop_user_id" TEXT;

-- Duplicate ad text and price for a listing on a non-default account.
ALTER TABLE "product_listings"
  ADD COLUMN "variant_title" TEXT,
  ADD COLUMN "variant_description" TEXT,
  ADD COLUMN "variant_price" DECIMAL(10,2),
  ADD COLUMN "variant_source" TEXT,
  ADD COLUMN "variant_basis" TEXT,
  ADD COLUMN "variant_generated_at" TIMESTAMP(3),
  ADD COLUMN "variant_error" TEXT;
