-- MVP schema: drop stub tables from 20260924173900_init, add warehouse + Wallapop tree.
-- Apply with `prisma migrate deploy` in issue #53. Do not run in this issue.

DROP TABLE IF EXISTS "product_listings" CASCADE;
DROP TABLE IF EXISTS "products" CASCADE;
DROP TABLE IF EXISTS "accounts" CASCADE;

CREATE TYPE "ProductCondition" AS ENUM (
  'NEW',
  'AS_GOOD_AS_NEW',
  'GOOD',
  'FAIR',
  'HAS_GIVEN_IT_ALL'
);

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "city" TEXT,
    "postal_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "wallapop_id" INTEGER NOT NULL,
    "parent_id" TEXT,
    "slug" TEXT NOT NULL,
    "name_es" TEXT NOT NULL,
    "name_uk" TEXT NOT NULL,
    "is_leaf" BOOLEAN NOT NULL,
    "leaf_selection_mandatory" BOOLEAN NOT NULL,
    "vertical_id" TEXT,
    "listing_type" TEXT,
    "path" VARCHAR(255) NOT NULL,
    "depth" INTEGER NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "seo_legacy_id" INTEGER,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "category_id" TEXT NOT NULL,
    "condition" "ProductCondition" NOT NULL,
    "brand" TEXT,
    "weight_kg" DECIMAL(8,3),
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "type_attributes" JSONB NOT NULL DEFAULT '{}',
    "sold_at" TIMESTAMP(3),
    "sold_price" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_listings" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'READY_TO_POST',
    "external_url" TEXT,
    "external_item_id" TEXT,
    "shipping_enabled" BOOLEAN NOT NULL DEFAULT false,
    "shipping_up_to_kg" INTEGER,
    "last_posted_at" TIMESTAMP(3),
    "last_edited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_listings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE UNIQUE INDEX "accounts_one_default" ON "accounts" ((true)) WHERE "is_default";

CREATE UNIQUE INDEX "categories_wallapop_id_key" ON "categories"("wallapop_id");
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");
CREATE INDEX "categories_parent_id_sort_order_idx" ON "categories"("parent_id", "sort_order");
CREATE INDEX "categories_path_idx" ON "categories"("path");

CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");
CREATE INDEX "products_status_idx" ON "products"("status");
CREATE INDEX "products_category_id_idx" ON "products"("category_id");
CREATE INDEX "products_title_idx" ON "products"("title");

CREATE INDEX "product_images_product_id_sort_order_idx" ON "product_images"("product_id", "sort_order");

CREATE INDEX "product_listings_status_idx" ON "product_listings"("status");
CREATE UNIQUE INDEX "product_listings_product_id_account_id_key" ON "product_listings"("product_id", "account_id");

ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_listings" ADD CONSTRAINT "product_listings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_listings" ADD CONSTRAINT "product_listings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
