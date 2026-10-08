"use client"

import { useEffect, useState } from "react"

import { Field } from "@/components/product-form/product-form-chrome"
import { Input } from "@/components/ui/input"
import { apiListBrands } from "@/lib/api/brands"

export function BrandPicker({
  categoryId,
  defaultValue,
  error,
}: {
  categoryId: string
  defaultValue?: string
  error?: string
}) {
  const [value, setValue] = useState(defaultValue ?? "")
  const [debounced, setDebounced] = useState(value)
  const [options, setOptions] = useState<string[]>([])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), 200)
    return () => window.clearTimeout(timer)
  }, [value])

  useEffect(() => {
    if (!categoryId) {
      setOptions([])
      return
    }
    let cancelled = false
    apiListBrands(categoryId, debounced)
      .then((brands) => {
        if (!cancelled) setOptions(brands)
      })
      .catch(() => {
        if (!cancelled) setOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [categoryId, debounced])

  const trimmed = value.trim()
  const suggestions = options
    .filter((name) => name.toLowerCase() !== trimmed.toLowerCase())
    .slice(0, 8)
  const exactMatch = options.some(
    (name) => name.toLowerCase() === trimmed.toLowerCase(),
  )
  const showCrear = trimmed.length > 0 && !exactMatch

  return (
    <Field label="Marca" htmlFor="brand" required error={error}>
      <Input
        id="brand"
        name="brand"
        required
        aria-required="true"
        maxLength={100}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="h-11"
        placeholder="Busca una marca"
        autoComplete="off"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "brand-error" : undefined}
      />
      {suggestions.length > 0 || showCrear ? (
        <ul className="mt-1 overflow-hidden rounded-lg border bg-background text-sm">
          {suggestions.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="flex h-10 w-full items-center px-3 text-left hover:bg-muted"
                onClick={() => setValue(name)}
              >
                {name}
              </button>
            </li>
          ))}
          {showCrear ? (
            <li className="px-3 py-2 text-muted-foreground">
              Crear «{trimmed}»
            </li>
          ) : null}
        </ul>
      ) : null}
    </Field>
  )
}
