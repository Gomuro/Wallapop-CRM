import http from "node:http"
import https from "node:https"
import type { IncomingHttpHeaders } from "node:http"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const DROP_REQ = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "transfer-encoding",
])

const DROP_RES = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "transfer-encoding",
])

function headerList(headers: IncomingHttpHeaders, name: string): string[] {
  const raw = headers[name]
  if (!raw) return []
  return Array.isArray(raw) ? raw : [raw]
}

function proxy(
  request: NextRequest,
  path: string[],
): Promise<NextResponse> {
  const upstream = process.env.API_UPSTREAM?.trim().replace(/\/$/, "")
  if (!upstream) {
    return Promise.resolve(
      NextResponse.json(
        {
          error: {
            code: "API_NOT_CONFIGURED",
            message: "API_UPSTREAM is not set.",
          },
        },
        { status: 503 },
      ),
    )
  }

  const dest = new URL(
    `${upstream}/api/v1/${path.join("/")}${request.nextUrl.search}`,
  )
  const lib = dest.protocol === "https:" ? https : http
  const method = request.method.toUpperCase()

  return request
    .arrayBuffer()
    .then(
      (buf) =>
        new Promise<NextResponse>((resolve) => {
          let settled = false
          const finish = (response: NextResponse) => {
            if (settled) return
            settled = true
            resolve(response)
          }
          const payload =
            method === "GET" || method === "HEAD"
              ? undefined
              : Buffer.from(buf)

          const headers: Record<string, string> = {}
          request.headers.forEach((value, key) => {
            if (!DROP_REQ.has(key.toLowerCase())) headers[key] = value
          })
          if (payload) headers["content-length"] = String(payload.length)

          const req = lib.request(
            {
              protocol: dest.protocol,
              hostname: dest.hostname,
              port: dest.port || (dest.protocol === "https:" ? 443 : 80),
              path: `${dest.pathname}${dest.search}`,
              method,
              headers,
              timeout: 5_000,
            },
            (res) => {
              const chunks: Buffer[] = []
              res.on("data", (chunk) =>
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
              )
              res.on("end", () => {
                const body = Buffer.concat(chunks)
                const out = new Headers()
                for (const [key, value] of Object.entries(res.headers)) {
                  const lower = key.toLowerCase()
                  if (DROP_RES.has(lower)) continue
                  if (lower === "set-cookie") continue
                  if (lower.startsWith("access-control-")) continue
                  if (typeof value === "string") out.set(key, value)
                }

                const response = new NextResponse(body, {
                  status: res.statusCode ?? 502,
                  headers: out,
                })
                for (const cookie of headerList(res.headers, "set-cookie")) {
                  response.headers.append("set-cookie", cookie)
                }
                finish(response)
              })
            },
          )
          req.on("timeout", () => {
            req.destroy()
          })
          req.on("error", () => {
            finish(
              NextResponse.json(
                {
                  error: {
                    code: "NETWORK",
                    message: "No se ha podido conectar con el servidor.",
                  },
                },
                { status: 502 },
              ),
            )
          })
          if (payload) req.write(payload)
          req.end()
        }),
    )
}

type RouteCtx = { params: Promise<{ path: string[] }> }

async function handle(request: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params
  return proxy(request, path ?? [])
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const OPTIONS = handle
