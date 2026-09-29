import type { PrismaClient } from "../../generated/prisma/client";

/** Roots that never appear in consumer-goods upload picker (motor, jobs, services, …). */
const CONSUMER_UPLOAD_EXCLUDED_ROOTS = new Set([
  100, // Coches
  14000, // Motos
  12800, // Motor y accesorios
  200, // Inmobiliaria
  21000, // Empleo
  13200, // Servicios
]);

export type CategoryBreadcrumbOptions = {
  /** Trim path for «Algo que ya no necesito» upload (no Coches/Motor in picker). */
  consumerGoodsPublish?: boolean;
};

/** Spanish labels root → leaf from materialized `Category.path` (wallapop_id segments). */
export async function categoryBreadcrumbLabelsEs(
  prisma: PrismaClient,
  categoryId: string,
  options?: CategoryBreadcrumbOptions,
): Promise<string[]> {
  const leaf = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { path: true },
  });
  if (!leaf?.path) return [];

  let wallapopIds = leaf.path
    .split("/")
    .filter(Boolean)
    .map((segment: string) => Number.parseInt(segment, 10))
    .filter((n: number) => Number.isFinite(n));

  if (!wallapopIds.length) return [];

  const rows = await prisma.category.findMany({
    where: { wallapopId: { in: wallapopIds } },
    select: { wallapopId: true, nameEs: true, verticalId: true },
  });
  const byId = new Map(rows.map((row) => [row.wallapopId, row.nameEs]));
  const verticalById = new Map(
    rows.map((row) => [row.wallapopId, row.verticalId]),
  );

  if (options?.consumerGoodsPublish) {
    let start = 0;
    for (let i = 0; i < wallapopIds.length; i++) {
      const id = wallapopIds[i]!;
      if (verticalById.get(id) === "consumer_goods") {
        start = i;
        break;
      }
      if (!CONSUMER_UPLOAD_EXCLUDED_ROOTS.has(id)) {
        start = i;
        break;
      }
    }
    wallapopIds = wallapopIds.slice(start);
    while (
      wallapopIds.length > 0 &&
      CONSUMER_UPLOAD_EXCLUDED_ROOTS.has(wallapopIds[0]!)
    ) {
      wallapopIds = wallapopIds.slice(1);
    }
  }

  return wallapopIds
    .map((id: number) => byId.get(id))
    .filter((name): name is string => Boolean(name?.trim()));
}
