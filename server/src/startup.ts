import { log, serializeError } from "./lib/log"
import { startWallapopAutopostLoop } from "./lib/wallapop-autopost"
import { recoverStalePostingOnBoot } from "./lib/wallapop-posting-watchdog"
import { rehydrateWallapopSessionOnBoot } from "./lib/wallapop-session"

/**
 * Post-`listen` hooks. Keep `index.ts` as boot + listen only.
 */
export function runStartupHooks(): void {
  void rehydrateWallapopSessionOnBoot()
    .then((s) =>
      log("info", "wallapop_session_rehydrate", {
        status: s.status,
        requires2FA: s.requires2FA,
      }),
    )
    .catch((err) =>
      log("warn", "wallapop_session_rehydrate_failed", {
        err: serializeError(err),
      }),
    )

  startWallapopAutopostLoop()
  void recoverStalePostingOnBoot()
}
