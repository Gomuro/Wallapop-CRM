CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "wallapop_id" VARCHAR(200) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "brands_wallapop_id_key" ON "brands"("wallapop_id");
CREATE INDEX "brands_name_idx" ON "brands"("name");

CREATE TABLE "brand_categories" (
    "brand_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,

    CONSTRAINT "brand_categories_pkey" PRIMARY KEY ("brand_id","category_id")
);

CREATE INDEX "brand_categories_category_id_idx" ON "brand_categories"("category_id");

ALTER TABLE "brand_categories" ADD CONSTRAINT "brand_categories_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brand_categories" ADD CONSTRAINT "brand_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
