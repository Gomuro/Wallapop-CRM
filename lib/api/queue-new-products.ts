import { apiClientFetch } from "@/lib/api/client"

export async function fetchQueueNewProducts(): Promise<boolean> {
  const body = await apiClientFetch<{ enabled: boolean }>("/accounts/queue-new-products")
  return body.enabled
}

export async function setQueueNewProducts(enabled: boolean): Promise<boolean> {
  const body = await apiClientFetch<{ enabled: boolean }>("/accounts/queue-new-products", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  })
  return body.enabled
}
