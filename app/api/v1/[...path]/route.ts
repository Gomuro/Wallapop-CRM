import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const HOP_BY_HOP = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

async function proxy(
  request: NextRequest,
  path: string[],
): Promise<NextResponse> {
  const upstream = process.env.API_UPSTREAM?.trim().replace(/\/$/, "")
  if (!upstream) {
    return NextResponse.json(
      { error: { code: "API_NOT_CONFIGURED", message: "API_UPSTREAM is not set." } },
      { status: 503 },
    )
  }

  const dest = `${upstream}/api/v1/${path.join("/")}${request.nextUrl.search}`
  const headers = new Headers()
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value)
  })

  const method = request.method.toUpperCase()
  const body =
    method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer()

  const upstreamRes = await fetch(dest, {
    method,
    headers,
    body,
    redirect: "manual",
    cache: "no-store",
  })

  const out = new Headers()
  upstreamRes.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (HOP_BY_HOP.has(lower)) return
    if (lower === "set-cookie") return
    if (lower.startsWith("access-control-")) return
    out.set(key, value)
  })

  const response = new NextResponse(upstreamRes.body, {
    status: upstreamRes.status,
    headers: out,
  })

  const cookies =
    typeof upstreamRes.headers.getSetCookie === "function"
      ? upstreamRes.headers.getSetCookie()
      : []
  for (const cookie of cookies) {
    response.headers.append("set-cookie", cookie)
  }

  return response
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
