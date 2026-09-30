export type AutopostRecentSkip = {
  at: string
  productId: string
  sku: string
  title: string
  code: string
  message: string
}

const MAX = 20
let recent: AutopostRecentSkip[] = []

export function recordAutopostSkip(
  entry: Omit<AutopostRecentSkip, "at">,
): AutopostRecentSkip {
  const row: AutopostRecentSkip = { ...entry, at: new Date().toISOString() }
  recent = [row, ...recent.filter((item) => item.productId !== entry.productId)]
  if (recent.length > MAX) recent = recent.slice(0, MAX)
  return row
}

export function getRecentAutopostSkips(): AutopostRecentSkip[] {
  return recent
}

export function resetAutopostRecentSkipsForTests(): void {
  recent = []
}
