import { apiClientFetch } from "@/lib/api/client"

export async function fetchDevMonitor(): Promise<{ enabled: boolean }> {
  return apiClientFetch("/dev/monitor")
}

export async function setDevMonitor(enabled: boolean): Promise<{ enabled: boolean }> {
  return apiClientFetch("/dev/monitor", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  })
}

export async function openDevAccountWatch(
  accountId: string,
): Promise<{ ok: boolean; port: number }> {
  return apiClientFetch(`/dev/accounts/${accountId}/watch`, {
    method: "POST",
    timeoutMs: 60_000,
  })
}
