-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "autopost_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "wallapop_email" TEXT;
