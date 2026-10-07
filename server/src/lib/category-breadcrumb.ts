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

function wallapopIdsFromPath(path: string): number[] {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment: string) => Number.parseInt(segment, 10))
    .filter((n: number) => Number.isFinite(n));
}

/** Drop motor/jobs/services prefixes so the picker starts at consumer goods. */
function trimConsumerGoodsPath(
  wallapopIds: number[],
  verticalById: ReadonlyMap<number, string | null>,
): number[] {
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
  const trimmed = wallapopIds.slice(start);
  while (
    trimmed.length > 0 &&
    CONSUMER_UPLOAD_EXCLUDED_ROOTS.has(trimmed[0]!)
  ) {
    trimmed.shift();
  }
  return trimmed;
}

function spanishLabelsInOrder(
  wallapopIds: number[],
  nameById: ReadonlyMap<number, string>,
): string[] {
  return wallapopIds
    .map((id: number) => nameById.get(id))
    .filter((name): name is string => Boolean(name?.trim()));
}

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

  let wallapopIds = wallapopIdsFromPath(leaf.path);
  if (!wallapopIds.length) return [];

  const rows = await prisma.category.findMany({
    where: { wallapopId: { in: wallapopIds } },
    select: { wallapopId: true, nameEs: true, verticalId: true },
  });
  const nameById = new Map(rows.map((row) => [row.wallapopId, row.nameEs]));

  if (options?.consumerGoodsPublish) {
    const verticalById = new Map(
      rows.map((row) => [row.wallapopId, row.verticalId]),
    );
    wallapopIds = trimConsumerGoodsPath(wallapopIds, verticalById);
  }

  return spanishLabelsInOrder(wallapopIds, nameById);
}
