import "server-only"

import { apiServerFetch } from "@/lib/api/server"
import type { ApiDefaultAccount } from "@/lib/api/types"

let defaultAccountCache: ApiDefaultAccount | null | undefined

export async function apiGetDefaultAccount(): Promise<ApiDefaultAccount | null> {
  if (defaultAccountCache !== undefined) return defaultAccountCache
  try {
    const { account } = await apiServerFetch<{ account: ApiDefaultAccount }>(
      "/accounts/default",
    )
    defaultAccountCache = account
    return account
  } catch {
    defaultAccountCache = null
    return null
  }
}
