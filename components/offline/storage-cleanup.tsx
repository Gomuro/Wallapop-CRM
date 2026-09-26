"use client"

import { useEffect } from "react"

import { purgeBloatedOfflineMedia } from "@/lib/offline/cache"

export function StorageCleanup() {
  useEffect(() => {
    purgeBloatedOfflineMedia()
  }, [])

  return null
}
