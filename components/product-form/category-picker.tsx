"use client"

import { useMemo, useState } from "react"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { childrenOf, categoryBreadcrumb } from "@/lib/categories/tree"
import type { ApiCategory } from "@/lib/api/types"

export function CategoryPicker({
  categories,
  value,
  onChange,
  error,
}: {
  categories: ApiCategory[]
  value: string
  onChange: (categoryId: string) => void
  error?: string
}) {
  const breadcrumb = useMemo(
    () => (value ? categoryBreadcrumb(categories, value) : []),
    [categories, value],
  )

  const [selectedPath, setSelectedPath] = useState<string[]>(() =>
    breadcrumb.map((item) => item.id),
  )

  const levels = useMemo(() => {
    const rows: ApiCategory[][] = []
    let parentId: string | null = null
    for (let depth = 0; depth < 8; depth += 1) {
      const options = childrenOf(categories, parentId)
      if (options.length === 0) break
      rows.push(options)
      const chosen = selectedPath[depth]
      const match = chosen
        ? options.find((item) => item.id === chosen)
        : undefined
      if (!match) break
      parentId = match.id
      if (match.isLeaf) break
    }
    return rows
  }, [categories, selectedPath])

  function pickLevel(depth: number, categoryId: string) {
    const next = selectedPath.slice(0, depth)
    next[depth] = categoryId
    setSelectedPath(next)
    const node = categories.find((item) => item.id === categoryId)
    if (node?.isLeaf) onChange(categoryId)
    else onChange("")
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name="categoryId" value={value} />
      {levels.map((options, depth) => (
        <div key={depth} className="space-y-1.5">
          <Label htmlFor={`category-level-${depth}`}>
            {depth === 0 ? "Categoría" : "Subcategoría"}
          </Label>
          <Select
            value={selectedPath[depth] ?? ""}
            onValueChange={(id) => id && pickLevel(depth, id)}
            items={Object.fromEntries(
              options.map((item) => [item.id, item.nameEs]),
            )}
          >
            <SelectTrigger
              id={`category-level-${depth}`}
              className="h-11 w-full data-[size=default]:h-11"
              aria-invalid={Boolean(error)}
            >
              <SelectValue placeholder="Elige…" />
            </SelectTrigger>
            <SelectContent>
              {options.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.nameEs}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
      {error ? (
        <p className="text-xs text-destructive" role="alert">{error}</p>
      ) : null}
    </div>
  )
}
