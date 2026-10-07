-- AlterEnum
ALTER TYPE "ListingStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "product_listings" ADD COLUMN "posting_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "product_listings" ADD COLUMN "last_publish_error" TEXT;
