import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { SESSION_COOKIE } from "@/lib/api/config"

function isProtectedPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/products" ||
    pathname.startsWith("/products/")
  )
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (!isProtectedPath(pathname)) {
    return NextResponse.next()
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value
  if (session) {
    return NextResponse.next()
  }

  const loginUrl = new URL("/login", request.url)
  if (pathname !== "/") {
    loginUrl.searchParams.set("redirect", pathname)
  }
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ["/", "/login", "/products/:path*"],
}
