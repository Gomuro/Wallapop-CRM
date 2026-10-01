/** Collapse Wallapop / CRM description noise so we can detect AI rewrites. */
export function normalizePublishDescription(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

export function crmDescriptionMatchesForm(
  actual: string,
  expected: string,
): boolean {
  const want = normalizePublishDescription(expected)
  if (!want) return true
  return normalizePublishDescription(actual) === want
}
