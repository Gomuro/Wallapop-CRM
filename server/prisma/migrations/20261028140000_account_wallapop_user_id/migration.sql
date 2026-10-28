-- Public Wallapop seller id per account. Add-only, nullable: no existing data changes.
ALTER TABLE "accounts"
  ADD COLUMN "wallapop_user_id" TEXT;
