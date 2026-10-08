import http from "node:http"
import https from "node:https"
import type { IncomingMessage } from "node:http"
import { NextRequest, NextResponse } from "next/server"

import { API_TIMEOUT_MS } from "@/lib/api/http"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 30

function appendUploadChunk(chunks: Buffer[]) {
  return function onUploadData(chunk: Buffer | string) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
}

export function uploadToNextResponse(res: IncomingMessage, chunks: Buffer[]) {
  const body = Buffer.concat(chunks)
  const headers = new Headers()
  const type = res.headers["content-type"]
  if (typeof type === "string") headers.set("content-type", type)
  const status = res.statusCode ?? 502
  if (status === 200) {
    headers.set("cache-control", "public, max-age=86400")
  } else {
    headers.set("cache-control", "no-store")
    headers.set("cdn-cache-control", "no-store")
    headers.set("vercel-cdn-cache-control", "no-store")
  }
  return new NextResponse(body, { status, headers })
}

export function collectUploadResponse(
  res: IncomingMessage,
  resolve: (response: NextResponse) => void,
) {
  const chunks: Buffer[] = []
  res.on("data", appendUploadChunk(chunks))
  res.on("end", () => resolve(uploadToNextResponse(res, chunks)))
}

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
        timeout: API_TIMEOUT_MS,
      },
      (res) => collectUploadResponse(res, resolve),
    )
    req.on("error", reject)
    req.end()
  })
}
