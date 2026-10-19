import { apiClientFetch } from "@/lib/api/client"
import type { ApiDefaultAccount } from "@/lib/api/types"

export type ApiAccountCard = ApiDefaultAccount & {
  autopostEnabled: boolean
  wallapopEmail: string | null
}

export async function listAccountCards(): Promise<ApiAccountCard[]> {
  const body = await apiClientFetch<{ accounts: ApiAccountCard[] }>("/accounts")
  return body.accounts
}

export async function deleteAccountCard(id: string): Promise<void> {
  await apiClientFetch(`/accounts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function createAccountCard(name: string): Promise<ApiAccountCard> {
  const body = await apiClientFetch<{ account: ApiAccountCard }>("/accounts", {
    method: "POST",
    body: JSON.stringify({ name }),
  })
  return body.account
}
