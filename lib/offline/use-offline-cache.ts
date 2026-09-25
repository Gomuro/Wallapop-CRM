"use client"

import { useMemo } from "react"
import { useSyncExternalStore } from "react"

import type { ApiCategory } from "@/lib/api/types"
import type { InventoryProduct } from "@/lib/inventory/types"

import {
  getOfflineCategoriesServerSnapshot,
  getOfflineCategoriesSnapshot,
  getOfflineProductsServerSnapshot,
  getOfflineProductsSnapshot,
  OFFLINE_CATEGORIES,
  subscribeOfflineCache,
} from "./cache"

function parseProducts(raw: string): InventoryProduct[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as InventoryProduct[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function useOfflineProducts(): InventoryProduct[] | null {
  const raw = useSyncExternalStore(
    subscribeOfflineCache,
    getOfflineProductsSnapshot,
    getOfflineProductsServerSnapshot,
  )
  return useMemo(() => parseProducts(raw), [raw])
}

export function useOfflineProduct(id: string): InventoryProduct | null | undefined {
  const products = useOfflineProducts()
  if (products === null) return undefined
  return products.find((product) => product.id === id) ?? null
}

export function useOfflineCategories(): ApiCategory[] {
  const raw = useSyncExternalStore(
    subscribeOfflineCache,
    getOfflineCategoriesSnapshot,
    getOfflineCategoriesServerSnapshot,
  )
  return useMemo(() => {
    try {
      const parsed = JSON.parse(raw) as ApiCategory[]
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : OFFLINE_CATEGORIES
    } catch {
      return OFFLINE_CATEGORIES
    }
  }, [raw])
}
