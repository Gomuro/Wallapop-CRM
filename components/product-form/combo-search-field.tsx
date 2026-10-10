"use client"

import { useEffect, useId, useRef, useState } from "react"

import { Field } from "@/components/product-form/product-form-chrome"
import { Input } from "@/components/ui/input"

export type ComboSearchOption = {
  id: string
  title: string
}

export function ComboSearchField({
  name,
  label,
  required,
  error,
  defaultValue,
  placeholder,
  options,
  onQueryChange,
}: {
  name: string
  label: string
  required?: boolean
  error?: string
  defaultValue?: string
  placeholder: string
  options: ComboSearchOption[]
  onQueryChange?: (query: string) => void
}) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const defaultOption = options.find(
    (option) => option.id === defaultValue || option.title === defaultValue,
  )
  const [value, setValue] = useState(defaultOption?.id ?? defaultValue ?? "")
  const [query, setQuery] = useState(defaultOption?.title ?? defaultValue ?? "")
  const [open, setOpen] = useState(false)

  useEffect(() => {
    onQueryChange?.(query)
  }, [onQueryChange, query])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  const trimmed = query.trim()
  const needle = trimmed.toLowerCase()
  const suggestions = options.filter((option) => {
    const title = option.title.toLowerCase()
    if (title === needle) return false
    return !needle || title.includes(needle)
  })
  const exactMatch = options.some(
    (option) => option.title.toLowerCase() === needle,
  )
  const showCreate = trimmed.length > 0 && !exactMatch
  const showList = open && (suggestions.length > 0 || showCreate)

  return (
    <Field label={label} htmlFor={name} required={required} error={error}>
      <div ref={rootRef} className="relative">
        <input type="hidden" name={name} value={value} />
        <Input
          id={name}
          required={required}
          aria-required={required ? "true" : undefined}
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          autoComplete="off"
          maxLength={100}
          value={query}
          placeholder={placeholder}
          className="h-11"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : undefined}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            const next = event.target.value
            setQuery(next)
            setValue(next.trim())
            setOpen(true)
          }}
        />
        {showList ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border bg-background text-sm shadow-md"
          >
            {suggestions.map((option) => (
              <li
                key={option.id}
                role="option"
                aria-selected={option.id === value || option.title === query}
              >
                <button
                  type="button"
                  className="flex min-h-10 w-full items-center px-3 text-left hover:bg-muted"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setQuery(option.title)
                    setValue(option.id)
                    setOpen(false)
                  }}
                >
                  {option.title}
                </button>
              </li>
            ))}
            {showCreate ? (
              <li className="px-3 py-2 text-muted-foreground">
                Crear «{trimmed}»
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </Field>
  )
}
