export type UploadFieldOption = {
  id: string
  title: string
}

export type CategoryUploadField = {
  id: string
  type: string
  required: boolean
  label: string
  min: number
  max: number
  options: UploadFieldOption[]
  source: string | null
}

/** Dedicated CRM sections — not rendered again from uploadFields. Brand is an upload field. */
export const CRM_OWNED_UPLOAD_FIELD_IDS = new Set([
  "photo",
  "title",
  "description",
  "condition",
  "price_amount",
  "measures",
  "suggested_data_banner",
  "lock_stocks",
])

export function extraUploadFields(
  fields: CategoryUploadField[],
): CategoryUploadField[] {
  return fields.filter((field) => !CRM_OWNED_UPLOAD_FIELD_IDS.has(field.id))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asBool(value: unknown): boolean {
  return value === true
}

function asInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  return fallback
}

function parseOptions(raw: unknown): UploadFieldOption[] {
  if (!Array.isArray(raw)) return []
  const out: UploadFieldOption[] = []
  for (const item of raw) {
    const row = asRecord(item)
    if (!row) continue
    const id = asString(row.id)
    if (!id) continue
    out.push({ id, title: asString(row.title) || id })
  }
  return out
}

function optionsFromData(data: Record<string, unknown>): UploadFieldOption[] {
  const action = asRecord(data.action)
  if (action) {
    const fromAction = parseOptions(action.options)
    if (fromAction.length) return fromAction
  }
  const source = asRecord(data.source)
  if (source) {
    const fromSource = parseOptions(source.options)
    if (fromSource.length) return fromSource
  }
  return parseOptions(data.options)
}

function labelFromComponent(
  id: string,
  data: Record<string, unknown>,
): string {
  const action = asRecord(data.action)
  const candidates = [
    asString(data.label),
    asString(data.placeholder),
    asString(data.title),
    action ? asString(action.title) : "",
  ]
  const found = candidates.find((item) => item.length > 0)
  if (!found) return id
  return found.replace(/\*+\s*$/u, "").trim() || id
}

function sourcePath(data: Record<string, unknown>): string | null {
  const source = asRecord(data.source)
  if (!source) return null
  const path = asString(source.path)
  return path || null
}

function limitsFromData(
  data: Record<string, unknown>,
  required: boolean,
): { min: number; max: number } {
  const action = asRecord(data.action)
  const min = asInt(action?.minimum, required ? 1 : 0)
  const max = asInt(action?.maximum, 1)
  return { min: Math.max(0, min), max: Math.max(1, max) }
}

export function parseUploadComponents(
  payload: unknown,
): CategoryUploadField[] {
  const root = asRecord(payload)
  const list = root && Array.isArray(root.components) ? root.components : []
  const fields: CategoryUploadField[] = []
  for (const item of list) {
    const row = asRecord(item)
    if (!row) continue
    const id = asString(row.id)
    if (!id) continue
    const data = asRecord(row.data) ?? {}
    const required = asBool(row.is_required)
    const { min, max } = limitsFromData(data, required)
    fields.push({
      id,
      type: asString(row.type) || "unknown",
      required,
      label: labelFromComponent(id, data),
      min: required ? Math.max(1, min) : min,
      max,
      options: optionsFromData(data),
      source: sourcePath(data),
    })
  }
  return fields
}

export function fingerprintUploadFields(fields: CategoryUploadField[]): string {
  return fields
    .map((field) => {
      const optionIds = field.options.map((option) => option.id).join(",")
      return `${field.id}:${field.type}:${field.required ? 1 : 0}:${field.min}:${field.max}:${optionIds}:${field.source ?? ""}`
    })
    .join("|")
}

export function uploadFieldsFromCategoryAttributes(
  attributes: unknown,
): CategoryUploadField[] {
  const record = asRecord(attributes)
  if (!record || !Array.isArray(record.uploadFields)) return []
  const out: CategoryUploadField[] = []
  for (const item of record.uploadFields) {
    const row = asRecord(item)
    if (!row) continue
    const id = asString(row.id)
    if (!id) continue
    out.push({
      id,
      type: asString(row.type) || "unknown",
      required: asBool(row.required),
      label: asString(row.label) || id,
      min: asInt(row.min, 0),
      max: Math.max(1, asInt(row.max, 1)),
      options: parseOptions(row.options),
      source: asString(row.source) || null,
    })
  }
  return out
}

export function brandFromTypeAttributes(typeAttributes: unknown): string {
  return selectedIdsForField(typeAttributes, "brand")[0] ?? ""
}

export function typeAttributesFromFormData(
  formData: FormData,
): Record<string, string[]> {
  const values: Record<string, string[]> = {}
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("attr_")) continue
    const id = key.slice(5)
    const str = String(value).trim()
    if (!id || !str) continue
    const list = values[id] ?? []
    if (!list.includes(str)) list.push(str)
    values[id] = list
  }
  return values
}

export function selectedIdsForField(
  typeAttributes: unknown,
  fieldId: string,
): string[] {
  const record = asRecord(typeAttributes)
  if (!record) return []
  const raw = record[fieldId]
  if (typeof raw === "string" && raw.trim()) return [raw.trim()]
  if (!Array.isArray(raw)) return []
  return raw.map((item) => String(item).trim()).filter(Boolean)
}

export function validateExtraUploadFields(
  fields: CategoryUploadField[],
  typeAttributes: unknown,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of extraUploadFields(fields)) {
    const selected = selectedIdsForField(typeAttributes, field.id)
    if (field.required && selected.length < Math.max(1, field.min)) {
      errors[field.id] = `Elige ${field.label}.`
    }
  }
  return errors
}
