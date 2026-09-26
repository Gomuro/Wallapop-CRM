"use client"

import { useEffect, useMemo, useState } from "react"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiClientFetch } from "@/lib/api/client"
import type { ApiCategory } from "@/lib/api/types"
import { childrenOf, categoryBreadcrumb } from "@/lib/categories/tree"

async function fetchChildren(parentId: string | null): Promise<ApiCategory[]> {
  const query = parentId
    ? `?parentId=${encodeURIComponent(parentId)}`
    : "?parentId=root"
  const { categories } = await apiClientFetch<{ categories: ApiCategory[] }>(
    `/categories${query}`,
  )
  return categories
}

async function fetchCategory(id: string): Promise<ApiCategory> {
  const { category } = await apiClientFetch<{ category: ApiCategory }>(
    `/categories/${id}`,
  )
  return category
}

function selectItems(options: ApiCategory[]) {
  return Object.fromEntries(options.map((item) => [item.id, item.nameEs]))
}

export function CategoryPicker({
  categories,
  initialRoots,
  value,
  onChange,
  error,
}: {
  categories?: ApiCategory[]
  initialRoots?: ApiCategory[]
  value: string
  onChange: (categoryId: string) => void
  error?: string
}) {
  const localTree =
    categories && categories.length > 0 ? categories : null

  if (localTree) {
    return (
      <LocalCategoryPicker
        categories={localTree}
        value={value}
        onChange={onChange}
        error={error}
      />
    )
  }

  return (
    <RemoteCategoryPicker
      initialRoots={initialRoots}
      value={value}
      onChange={onChange}
      error={error}
    />
  )
}

function LocalCategoryPicker({
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
    <LevelSelects
      levels={levels}
      selectedPath={selectedPath}
      onPick={pickLevel}
      error={error}
      value={value}
    />
  )
}

function RemoteCategoryPicker({
  initialRoots,
  value,
  onChange,
  error,
}: {
  initialRoots?: ApiCategory[]
  value: string
  onChange: (categoryId: string) => void
  error?: string
}) {
  const [levels, setLevels] = useState<ApiCategory[][]>(() =>
    initialRoots && initialRoots.length > 0 ? [initialRoots] : [],
  )
  const [selectedPath, setSelectedPath] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const leafId = value
    const roots = initialRoots

    async function prepare() {
      try {
        if (leafId) {
          const chain: ApiCategory[] = []
          let current: string | null = leafId
          const seen = new Set<string>()
          while (current && !seen.has(current)) {
            seen.add(current)
            const node = await fetchCategory(current)
            chain.unshift(node)
            current = node.parentId
          }
          if (cancelled) return
          const nextLevels: ApiCategory[][] = []
          for (let i = 0; i < chain.length; i += 1) {
            const parentId = i === 0 ? null : chain[i - 1]?.id ?? null
            nextLevels.push(await fetchChildren(parentId))
          }
          const last = chain[chain.length - 1]
          if (last && !last.isLeaf) {
            const kids = await fetchChildren(last.id)
            if (kids.length > 0) nextLevels.push(kids)
          }
          if (cancelled) return
          setLevels(nextLevels)
          setSelectedPath(chain.map((item) => item.id))
          return
        }

        if (roots && roots.length > 0) return
        const fetched = await fetchChildren(null)
        if (cancelled) return
        setLevels([fetched])
      } catch {
        if (!cancelled) {
          setLoadError("No se ha podido cargar el árbol de categorías.")
        }
      }
    }

    void prepare()
    return () => {
      cancelled = true
    }
  }, [initialRoots, value])

  async function pickLevel(depth: number, categoryId: string) {
    const nextPath = selectedPath.slice(0, depth)
    nextPath[depth] = categoryId
    setSelectedPath(nextPath)
    const node = levels[depth]?.find((item) => item.id === categoryId)
    if (!node) return
    if (node.isLeaf) {
      setLevels(levels.slice(0, depth + 1))
      onChange(categoryId)
      return
    }
    onChange("")
    try {
      const kids = await fetchChildren(categoryId)
      if (kids.length === 0) {
        setLevels(levels.slice(0, depth + 1))
        onChange(categoryId)
        return
      }
      setLevels([...levels.slice(0, depth + 1), kids])
    } catch {
      setLoadError("No se ha podido cargar el árbol de categorías.")
    }
  }

  return (
    <LevelSelects
      levels={levels}
      selectedPath={selectedPath}
      onPick={(depth, id) => void pickLevel(depth, id)}
      error={error ?? loadError ?? undefined}
      value={value}
    />
  )
}

function LevelSelects({
  levels,
  selectedPath,
  onPick,
  error,
  value,
}: {
  levels: ApiCategory[][]
  selectedPath: string[]
  onPick: (depth: number, categoryId: string) => void
  error?: string
  value: string
}) {
  return (
    <div className="space-y-2">
      <input type="hidden" name="categoryId" value={value} />
      {levels.map((options, depth) => (
        <div key={depth} className="space-y-1.5">
          <Label htmlFor={`category-level-${depth}`}>
            {depth === 0 ? "Categoría" : "Subcategoría"}
          </Label>
          <Select
            value={selectedPath[depth] ?? null}
            onValueChange={(id) => id && onPick(depth, id)}
            items={selectItems(options)}
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
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
