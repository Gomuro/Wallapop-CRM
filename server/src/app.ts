import cookieParser from "cookie-parser"
import cors from "cors"
import express from "express"

import { errorHandler, notFoundHandler } from "./middleware/error-handler"
import { v1 } from "./routes/v1"

function corsOrigin() {
  const raw = process.env.CORS_ORIGIN ?? "http://localhost:3000"
  const allowed = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  return (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    if (!origin || allowed.includes(origin) || allowed.includes("*")) {
      callback(null, true)
      return
    }
    callback(null, false)
  }
}

function health(_req: express.Request, res: express.Response) {
  res.json({
    ok: true,
    service: "wallapop-crm-server",
    timestamp: new Date().toISOString(),
  })
}

export function createApp() {
  const app = express()
  app.disable("x-powered-by")
  app.use(cors({ origin: corsOrigin(), credentials: true }))
  app.use(cookieParser())
  app.use(express.json({ limit: "1mb" }))

  app.get("/health", health)
  app.get("/api/health", health)

  app.use("/api/v1", v1)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
