import http from "node:http"
import https from "node:https"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const upstream = process.env.API_UPSTREAM?.trim().replace(/\/$/, "")
  if (!upstream) {
    return new NextResponse("uploads upstream is not configured", { status: 503 })
  }

  const { path } = await ctx.params
  const dest = new URL(`${upstream}/uploads/${(path ?? []).join("/")}`)
  const lib = dest.protocol === "https:" ? https : http

  return new Promise<NextResponse>((resolve, reject) => {
    const req = lib.request(
      {
        protocol: dest.protocol,
        hostname: dest.hostname,
        port: dest.port || (dest.protocol === "https:" ? 443 : 80),
        path: `${dest.pathname}${dest.search}`,
        method: "GET",
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        )
        res.on("end", () => {
          const body = Buffer.concat(chunks)
          const headers = new Headers()
          const type = res.headers["content-type"]
          if (typeof type === "string") headers.set("content-type", type)
          headers.set("cache-control", "public, max-age=86400")
          resolve(
            new NextResponse(body, {
              status: res.statusCode ?? 502,
              headers,
            }),
          )
        })
      },
    )
    req.on("error", reject)
    req.end()
  })
}
