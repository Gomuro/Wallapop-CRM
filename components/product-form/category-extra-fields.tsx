"use client"

import { useEffect, useState } from "react"

import { ComboSearchField } from "@/components/product-form/combo-search-field"
import { Field } from "@/components/product-form/product-form-chrome"
import { BrandPicker } from "@/components/product-form/product-form-brand"
import { apiGetCategoryFields } from "@/lib/api/category-fields"
import type { CategoryUploadField } from "@/lib/inventory/category-upload-fields"
import { selectedIdsForField } from "@/lib/inventory/category-upload-fields"

export function CategoryExtraFields({
  categoryId,
  typeAttributes,
  brandFallback,
  fieldErrors,
}: {
  categoryId: string
  typeAttributes?: unknown
  brandFallback?: string
  fieldErrors?: Record<string, string>
}) {
  const [fields, setFields] = useState<CategoryUploadField[]>([])

  useEffect(() => {
    if (!categoryId) {
      setFields([])
      return
    }
    let cancelled = false
    apiGetCategoryFields(categoryId)
      .then((next) => {
        if (!cancelled) setFields(next)
      })
      .catch(() => {
        if (!cancelled) setFields([])
      })
    return () => {
      cancelled = true
    }
  }, [categoryId])

  if (!categoryId || fields.length === 0) return null

  return (
    <>
      {fields.map((field) => (
        <UploadFieldInput
          key={field.id}
          field={field}
          defaultSelected={
            field.id === "brand" &&
            selectedIdsForField(typeAttributes, field.id).length === 0 &&
            brandFallback
              ? [brandFallback]
              : selectedIdsForField(typeAttributes, field.id)
          }
          error={
            fieldErrors?.[field.id] ??
            (field.id === "brand" ? fieldErrors?.brand : undefined)
          }
          categoryId={categoryId}
        />
      ))}
    </>
  )
}

function UploadFieldInput({
  field,
  defaultSelected,
  error,
  categoryId,
}: {
  field: CategoryUploadField
  defaultSelected: string[]
  error?: string
  categoryId: string
}) {
  const name = `attr_${field.id}`
  if (field.id === "brand") {
    return (
      <BrandPicker
        categoryId={categoryId}
        defaultValue={defaultSelected[0] ?? ""}
        error={error}
        name={name}
        label={field.label}
        required={field.required}
      />
    )
  }
  if (field.type === "combo_box") {
    return (
      <ComboSearchField
        name={name}
        label={field.label}
        required={field.required}
        error={error}
        defaultValue={
          field.options.find((option) => defaultSelected.includes(option.id))
            ?.title ?? defaultSelected[0] ?? ""
        }
        placeholder={`Busca ${field.label.toLowerCase()}`}
        options={field.options}
      />
    )
  }
  if (field.options.length === 0) {
    return (
      <Field label={field.label} htmlFor={name} required={field.required} error={error}>
        <input
          id={name}
          name={name}
          defaultValue={defaultSelected[0] ?? ""}
          required={field.required}
          className="flex h-11 w-full rounded-lg border bg-background px-3 text-sm"
        />
      </Field>
    )
  }
  if (field.max <= 1) {
    return (
      <Field label={field.label} htmlFor={name} required={field.required} error={error}>
        <select
          id={name}
          name={name}
          required={field.required}
          defaultValue={defaultSelected[0] ?? ""}
          className="flex h-11 w-full rounded-lg border bg-background px-3 text-sm"
        >
          <option value="">{field.required ? "Elige…" : "—"}</option>
          {field.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
        </select>
      </Field>
    )
  }
  return (
    <Field label={field.label} required={field.required} error={error}>
      <ul className="grid grid-cols-2 gap-1 rounded-lg border p-2 text-sm">
        {field.options.map((option) => (
          <li key={option.id}>
            <label className="flex min-h-10 items-center gap-2 px-1">
              <input
                type="checkbox"
                name={name}
                value={option.id}
                defaultChecked={defaultSelected.includes(option.id)}
              />
              {option.title}
            </label>
          </li>
        ))}
      </ul>
    </Field>
  )
}
