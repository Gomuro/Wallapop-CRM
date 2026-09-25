export function prismaErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined
  if (!("code" in error) || typeof error.code !== "string") return undefined
  return error.code
}

export function isUniqueConstraint(error: unknown, field?: string) {
  if (prismaErrorCode(error) !== "P2002") return false
  if (!field) return true
  if (typeof error !== "object" || error === null || !("meta" in error)) {
    return true
  }
  const meta = error.meta
  if (typeof meta !== "object" || meta === null || !("target" in meta)) {
    return true
  }
  const target = meta.target
  if (Array.isArray(target)) return target.includes(field)
  if (typeof target === "string") return target.includes(field)
  return true
}
