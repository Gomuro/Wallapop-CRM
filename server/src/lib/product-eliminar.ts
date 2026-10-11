import { getPrisma } from "./db"

type PrismaDb = NonNullable<ReturnType<typeof getPrisma>>

/**
 * After Wallapop Eliminar: default-account listing becomes DEACTIVATED and
 * forgets the dead /item/ URL. Warehouse `products.status` stays as it is.
 */
export async function deactivateListingAfterEliminar(
  prisma: PrismaDb,
  productId: string,
): Promise<number> {
  const result = await prisma.productListing.updateMany({
    where: { productId, account: { isDefault: true } },
    data: { status: "DEACTIVATED", externalUrl: null },
  })
  return result.count
}
