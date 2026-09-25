"use client"

import { useEffect } from "react"

import type { ApiCategory } from "@/lib/api/types"
import { rememberOfflineCategories } from "@/lib/offline/cache"

export function CategoryCacheHydrator({
  categories,
}: {
  categories: ApiCategory[]
}) {
  useEffect(() => {
    rememberOfflineCategories(categories)
  }, [categories])

  return null
}
