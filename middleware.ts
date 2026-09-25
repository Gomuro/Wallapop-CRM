import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { SESSION_COOKIE } from "@/lib/api/config"

function apiBase(): string | null {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "")
  return base || null
}

async function sessionValidOnApi(sessionValue: string): Promise<boolean> {
  const base = apiBase()
  if (!base) return false
  try {
    const res = await fetch(`${base}/api/v1/auth/me`, {
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
    if (session && (await sessionValidOnApi(session))) {
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
    // Cross-origin: session cookie lives on API host; client SessionGuard enforces auth.
    return NextResponse.next()
  }

  if (!(await sessionValidOnApi(session))) {
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
