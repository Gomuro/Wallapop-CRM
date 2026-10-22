import type { SessionState } from "./state"

/** A DISCONNECTED account is re-probed at most this often (status polls, monitor loop). */
export const SESSION_PROBE_BACKOFF_MS = 5 * 60 * 1000

const lastProbeAt = new Map<string, number>()

export function resetSessionProbeBackoffForTests(): void {
  lastProbeAt.clear()
}

export function markSessionProbed(accountId: string, now = Date.now()): void {
  lastProbeAt.set(accountId, now)
}

/**
 * No probe while login is running (AUTHENTICATING). A DISCONNECTED account
 * waits out the backoff so polling does not respawn Chrome every minute.
 */
export function shouldProbeSession(
  accountId: string,
  status: SessionState["status"],
  now = Date.now(),
): boolean {
  if (status === "AUTHENTICATING") return false
  if (status !== "DISCONNECTED") return true
  const last = lastProbeAt.get(accountId)
  return last == null || now - last >= SESSION_PROBE_BACKOFF_MS
}
