import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { isApiProxy, SESSION_COOKIE } from "@/lib/api/config"

function meUrl(request: NextRequest): string | null {
  if (isApiProxy()) {
    return new URL("/api/v1/auth/me", request.url).toString()
  }
  const upstream = process.env.API_UPSTREAM?.trim().replace(/\/$/, "")
  if (upstream) return `${upstream}/api/v1/auth/me`
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "")
  return base ? `${base}/api/v1/auth/me` : null
}

async function sessionValidOnApi(
  request: NextRequest,
  sessionValue: string,
): Promise<boolean> {
  const url = meUrl(request)
  if (!url) return false
  try {
    const res = await fetch(url, {
      headers: { Cookie: `${SESSION_COOKIE}=${sessionValue}` },
      cache: "no-store",
    })
    return res.ok
  } catch {
    return false
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const session = request.cookies.get(SESSION_COOKIE)?.value

  if (pathname === "/login") {
    if (session && (await sessionValidOnApi(request, session))) {
      const target = request.nextUrl.searchParams.get("redirect") || "/"
      const safe = target.startsWith("/") ? target : "/"
      return NextResponse.redirect(new URL(safe, request.url))
    }
    return NextResponse.next()
  }

  const isProtected =
    pathname === "/" || pathname === "/products" || pathname.startsWith("/products/")

  if (!isProtected) {
    return NextResponse.next()
  }

  if (!session) {
    return NextResponse.next()
  }

  if (!(await sessionValidOnApi(request, session))) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("redirect", pathname)
    const response = NextResponse.redirect(loginUrl)
    response.cookies.delete(SESSION_COOKIE)
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/", "/login", "/products/:path*"],
}
