"use client"

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
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

type CategoryPickerProps = {
  categories?: ApiCategory[]
  initialRoots?: ApiCategory[]
  value: string
  onChange: (categoryId: string) => void
  error?: string
}

class CategoryErrorBoundary extends Component<
  { children: ReactNode; onReset?: () => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; onReset?: () => void }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("CategoryPicker error:", error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">
            No se ha podido mostrar el selector de categorías.
          </p>
          {this.state.error?.message ? (
            <p className="font-mono text-xs text-muted-foreground">
              {this.state.error.message}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              this.setState({ hasError: false, error: null })
              this.props.onReset?.()
            }}
          >
            Reintentar
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

export function CategoryPicker(props: CategoryPickerProps) {
  return (
    <CategoryErrorBoundary>
      <CategoryPickerContent {...props} />
    </CategoryErrorBoundary>
  )
}

function CategoryPickerContent({
  categories,
  initialRoots,
  value,
  onChange,
  error,
}: CategoryPickerProps) {
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
  const lastInternalValueRef = useRef<string>("")

  useEffect(() => {
    let cancelled = false
    const leafId = value

    // If the leaf matches what was chosen internally by user interaction,
    // do not rebuild (rebuilding remounts Selects, re-fetches redundant data, and crashes mobile browsers).
    if (leafId && leafId === lastInternalValueRef.current) {
      return
    }

    if (!leafId) {
      lastInternalValueRef.current = ""
      if (!initialRoots || initialRoots.length === 0) {
        void fetchChildren(null)
          .then((fetched) => {
            if (!cancelled) setLevels([fetched])
          })
          .catch(() => {
            if (!cancelled) {
              setLoadError("No se ha podido cargar el árbol de categorías.")
            }
          })
      }
      return
    }

    async function prepare() {
      try {
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
        lastInternalValueRef.current = leafId
        setLevels(nextLevels)
        setSelectedPath(chain.map((item) => item.id))
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
      lastInternalValueRef.current = categoryId
      onChange(categoryId)
      return
    }
    lastInternalValueRef.current = ""
    onChange("")
    try {
      const kids = await fetchChildren(categoryId)
      if (kids.length === 0) {
        setLevels(levels.slice(0, depth + 1))
        lastInternalValueRef.current = categoryId
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
      {levels.map((options, depth) => {
        const selected = selectedPath[depth] ?? null
        const safeValue =
          selected && options.some((item) => item.id === selected)
            ? selected
            : null
        return (
          <LevelSelect
            key={depth}
            depth={depth}
            options={options}
            value={safeValue}
            onPick={onPick}
            error={error}
          />
        )
      })}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function LevelSelect({
  depth,
  options,
  value,
  onPick,
  error,
}: {
  depth: number
  options: ApiCategory[]
  value: string | null
  onPick: (depth: number, categoryId: string) => void
  error?: string
}) {
  const items = useMemo(() => selectItems(options), [options])

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`category-level-${depth}`}>
        {depth === 0 ? "Categoría" : "Subcategoría"}
      </Label>
      <Select
        value={value}
        onValueChange={(id) => id && onPick(depth, id)}
        items={items}
      >
        <SelectTrigger
          id={`category-level-${depth}`}
          className="h-11 w-full data-[size=default]:h-11"
          aria-invalid={Boolean(error)}
        >
          <SelectValue placeholder="Elige…" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {options.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.nameEs}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
