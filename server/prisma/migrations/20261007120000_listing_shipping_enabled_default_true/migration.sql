-- Publish already treated envío as on; the CRM flag was ignored.
ALTER TABLE "product_listings" ALTER COLUMN "shipping_enabled" SET DEFAULT true;

UPDATE "product_listings" SET "shipping_enabled" = true;
