-- CreateTable
CREATE TABLE "operator_settings" (
    "id" TEXT NOT NULL,
    "queue_new_product_all_accounts" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "operator_settings_pkey" PRIMARY KEY ("id")
);
