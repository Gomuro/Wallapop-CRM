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

export async function dismissAccountRestriction(id: string): Promise<void> {
  await apiClientFetch(`/accounts/${encodeURIComponent(id)}/restriction/dismiss`, {
    method: "POST",
  })
}

/** Saves the duplicate price ending; queued duplicates of the account get the new price. */
export async function updateAccountPriceEnding(
  id: string,
  priceEnding: number,
): Promise<{ account: ApiAccountCard; repriced: number }> {
  return apiClientFetch<{ account: ApiAccountCard; repriced: number }>(
    `/accounts/${encodeURIComponent(id)}/price-ending`,
    { method: "PATCH", body: JSON.stringify({ priceEnding }) },
  )
}

export async function createAccountCard(name: string): Promise<ApiAccountCard> {
  const body = await apiClientFetch<{ account: ApiAccountCard }>("/accounts", {
    method: "POST",
    body: JSON.stringify({ name }),
  })
  return body.account
}
