export function wallapopIdToCategoryId(
  rows: { id: string; wallapopId: number }[],
): Map<number, string> {
  return new Map(rows.map((row) => [row.wallapopId, row.id]))
}

export function targetCategoryId(
  sourceWallapopId: number | null | undefined,
  targetByWallapopId: ReadonlyMap<number, string>,
): string | null {
  if (sourceWallapopId == null) return null
  return targetByWallapopId.get(sourceWallapopId) ?? null
}
