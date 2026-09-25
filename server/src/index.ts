import "../load-env"

import { createApp } from "./app"
import { log, serializeError } from "./lib/log"

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
})

server.on("error", (err) => {
  log("error", "listen_failed", { port, err: serializeError(err) })
  process.exit(1)
})
