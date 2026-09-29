-- AlterEnum
CREATE TYPE "ShippingPackageSize" AS ENUM ('STANDARD', 'BULKY');

-- AlterTable
ALTER TABLE "products" ADD COLUMN "shipping_package_size" "ShippingPackageSize",
ADD COLUMN "width_cm" DECIMAL(8,2),
ADD COLUMN "length_cm" DECIMAL(8,2),
ADD COLUMN "height_cm" DECIMAL(8,2);
