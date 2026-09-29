import "../load-env"

import { createApp } from "./app"
import { log, serializeError } from "./lib/log"
import { rehydrateWallapopSessionOnBoot } from "./lib/wallapop-session"

process.on("uncaughtException", (err) => {
  log("error", "uncaughtException", { err: serializeError(err) })
  process.exit(1)
})

process.on("unhandledRejection", (reason) => {
  log("error", "unhandledRejection", { err: serializeError(reason) })
})

const port = Number(process.env.PORT ?? 4000)
const app = createApp()

const server = app.listen(port, () => {
  log("info", "listening", { port })
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
})

server.on("error", (err) => {
  log("error", "listen_failed", { port, err: serializeError(err) })
  process.exit(1)
})
