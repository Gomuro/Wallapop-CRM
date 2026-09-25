"use client"

import { useEffect } from "react"

import { rememberOfflineProducts } from "@/lib/offline/cache"
import type { InventoryProduct } from "@/lib/inventory/types"

export function ProductCacheHydrator({ product }: { product: InventoryProduct }) {
  useEffect(() => {
    rememberOfflineProducts([product])
  }, [product])

  return null
}
