"use client"

import { useCallback, useEffect, useState } from "react"

import { ComboSearchField } from "@/components/product-form/combo-search-field"
import { apiListBrands } from "@/lib/api/brands"

export function BrandPicker({
  categoryId,
  defaultValue,
  error,
  name = "attr_brand",
  label = "Marca",
  required = false,
}: {
  categoryId: string
  defaultValue?: string
  error?: string
  name?: string
  label?: string
  required?: boolean
}) {
  const [query, setQuery] = useState(defaultValue ?? "")
  const [debounced, setDebounced] = useState(query)
  const [options, setOptions] = useState<string[]>([])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 200)
    return () => window.clearTimeout(timer)
  }, [query])

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

  const onQueryChange = useCallback((next: string) => {
    setQuery(next)
  }, [])

  return (
    <ComboSearchField
      name={name}
      label={label}
      required={required}
      error={error}
      defaultValue={defaultValue}
      placeholder="Busca una marca"
      options={options.map((name) => ({ id: name, title: name }))}
      onQueryChange={onQueryChange}
    />
  )
}
