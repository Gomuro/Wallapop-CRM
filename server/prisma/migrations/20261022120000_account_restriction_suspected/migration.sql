-- Restriction suspicion on an account (a hint, not a verdict) and when a listing went missing.
ALTER TABLE "accounts"
  ADD COLUMN "restriction_suspected_at" TIMESTAMP(3),
  ADD COLUMN "restriction_reason" TEXT;

ALTER TABLE "product_listings"
  ADD COLUMN "missing_at" TIMESTAMP(3);
