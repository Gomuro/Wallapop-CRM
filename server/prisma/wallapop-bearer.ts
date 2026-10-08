import { chromium, type APIRequestContext } from "playwright"

import { wallapopSessionHeaders, type BrandHttp } from "./wallapop-brand-options"

const CDP_URL = process.env.WALLAPOP_CDP_URL?.trim() || "http://127.0.0.1:9222"

function httpFromBearer(bearer: string): BrandHttp {
  return {
    async getJson(url: string) {
      const response = await fetch(url, {
        headers: wallapopSessionHeaders(bearer),
      })
      if (!response.ok) {
        throw new Error(`Wallapop brand options HTTP ${response.status}`)
      }
      return response.json()
    },
  }
}

function httpFromRequest(request: APIRequestContext): BrandHttp {
  return {
    async getJson(url: string) {
      const response = await request.get(url, {
        headers: wallapopSessionHeaders(),
      })
      if (!response.ok()) {
        throw new Error(`Wallapop brand options HTTP ${response.status()}`)
      }
      return response.json()
    },
  }
}

export async function resolveBrandHttp(): Promise<BrandHttp> {
  const bearer = process.env.WALLAPOP_BEARER?.trim() ?? ""
  if (bearer) return httpFromBearer(bearer)

  const browser = await chromium.connectOverCDP(CDP_URL)
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((item) => item.url().includes("es.wallapop.com"))
  if (!page) {
    throw new Error(
      "No Wallapop tab on Chrome CDP. Open es.wallapop.com logged in, or set WALLAPOP_BEARER.",
    )
  }
  return httpFromRequest(page.context().request)
}
