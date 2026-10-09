import http from "node:http"
import https from "node:https"
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from "node:http"
import { NextRequest, NextResponse } from "next/server"

import { API_TIMEOUT_MS } from "@/lib/api/http"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 120

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

function apiNotConfigured() {
  return NextResponse.json(
    {
      error: {
        code: "API_NOT_CONFIGURED",
        message: "API_UPSTREAM is not set.",
      },
    },
    { status: 503 },
  )
}

function onceFinish(resolve: (response: NextResponse) => void) {
  let settled = false
  return function finish(response: NextResponse) {
    if (settled) return
    settled = true
    resolve(response)
  }
}

export function requestHeadersFrom(
  request: NextRequest,
  payload?: Buffer,
): Record<string, string> {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    if (!DROP_REQ.has(key.toLowerCase())) headers[key] = value
  })
  if (payload) headers["content-length"] = String(payload.length)
  return headers
}

function proxyTimeoutMs(pathname: string): number {
  if (
    pathname.includes("/wallapop-sold") ||
    pathname.includes("/publish") ||
    pathname.includes("/connect")
  ) {
    return 120_000
  }
  return API_TIMEOUT_MS
}

function upstreamRequestOptions(
  dest: URL,
  method: string,
  headers: Record<string, string>,
) {
  return {
    protocol: dest.protocol,
    hostname: dest.hostname,
    port: dest.port || (dest.protocol === "https:" ? 443 : 80),
    path: `${dest.pathname}${dest.search}`,
    method,
    headers,
    timeout: proxyTimeoutMs(dest.pathname),
  }
}

function appendProxyChunk(chunks: Buffer[]) {
  return function onProxyData(chunk: Buffer | string) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
}

export function upstreamToNextResponse(
  res: IncomingMessage,
  chunks: Buffer[],
): NextResponse {
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
  return response
}

export function mapUpstreamResponse(
  res: IncomingMessage,
  finish: (response: NextResponse) => void,
) {
  const chunks: Buffer[] = []
  res.on("data", appendProxyChunk(chunks))
  res.on("end", () => finish(upstreamToNextResponse(res, chunks)))
}

function logProxyTimeout(req: ClientRequest, dest: URL, method: string) {
  console.error(
    JSON.stringify({
      t: new Date().toISOString(),
      msg: "proxy_timeout",
      method,
      path: dest.pathname,
    }),
  )
  req.destroy()
}

function networkProxyError() {
  return NextResponse.json(
    {
      error: {
        code: "NETWORK",
        message: "No se ha podido conectar con el servidor.",
      },
    },
    { status: 502 },
  )
}

function logProxyError(
  err: Error,
  dest: URL,
  method: string,
  finish: (response: NextResponse) => void,
) {
  console.error(
    JSON.stringify({
      t: new Date().toISOString(),
      msg: "proxy_error",
      method,
      path: dest.pathname,
      err: err.message,
    }),
  )
  finish(networkProxyError())
}

export function attachProxyGuards(
  req: ClientRequest,
  dest: URL,
  method: string,
  finish: (response: NextResponse) => void,
) {
  req.on("timeout", () => logProxyTimeout(req, dest, method))
  req.on("error", (err) => logProxyError(err, dest, method, finish))
}

export function forwardUpstream(input: {
  buf: ArrayBuffer
  request: NextRequest
  dest: URL
  lib: typeof http | typeof https
  method: string
}): Promise<NextResponse> {
  const { buf, request, dest, lib, method } = input
  const payload =
    method === "GET" || method === "HEAD" ? undefined : Buffer.from(buf)
  const headers = requestHeadersFrom(request, payload)
  return new Promise((resolve) => {
    const finish = onceFinish(resolve)
    const req = lib.request(
      upstreamRequestOptions(dest, method, headers),
      (res) => mapUpstreamResponse(res, finish),
    )
    attachProxyGuards(req, dest, method, finish)
    if (payload) req.write(payload)
    req.end()
  })
}

function proxy(
  request: NextRequest,
  path: string[],
): Promise<NextResponse> {
  const upstream = process.env.API_UPSTREAM?.trim().replace(/\/$/, "")
  if (!upstream) return Promise.resolve(apiNotConfigured())
  const dest = new URL(
    `${upstream}/api/v1/${path.join("/")}${request.nextUrl.search}`,
  )
  const lib = dest.protocol === "https:" ? https : http
  const method = request.method.toUpperCase()
  return request
    .arrayBuffer()
    .then((buf) => forwardUpstream({ buf, request, dest, lib, method }))
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
