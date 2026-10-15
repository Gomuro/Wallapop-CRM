-- AlterTable
ALTER TABLE "products" ADD COLUMN "sold_account_id" TEXT;

-- CreateIndex
CREATE INDEX "products_sold_account_id_idx" ON "products"("sold_account_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_sold_account_id_fkey" FOREIGN KEY ("sold_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
