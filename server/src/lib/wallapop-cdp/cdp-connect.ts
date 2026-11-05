/**
 * Low-level Chrome CDP connection: wait for the port, connect, quit what listens.
 */
import { chromium } from "playwright"

import { firstCdpPort } from "../../../../lib/accounts/chrome-place"
import { assertWallapopOnline } from "../wallapop-offline"
import { promiseWithin } from "./busy"
import { killSpawnedChrome } from "./chrome"

const CDP_CONNECT_TIMEOUT_MS = 15_000
const CDP_READY_TIMEOUT_MS = 30_000
const QUIT_CLOSE_MS = 8_000

export const CDP_PORT = firstCdpPort()

export function cdpUrlForPort(port: number): string {
  if (port === CDP_PORT && process.env.WALLAPOP_CDP_URL?.trim()) {
    return process.env.WALLAPOP_CDP_URL.trim()
  }
  return `http://127.0.0.1:${port}`
}

export async function waitForCdp(cdpUrl: string, timeoutMs = CDP_READY_TIMEOUT_MS) {
  const versionUrl = `${cdpUrl.replace(/\/$/, "")}/json/version`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(versionUrl, {
        signal: AbortSignal.timeout(1_500),
      })
      if (response.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(
    `Chrome CDP no respondió en ${cdpUrl}. ¿Arrancó Chrome con --remote-debugging-port=${CDP_PORT}?`,
  )
}

export async function connectOverCdp(cdpUrl: string) {
  assertWallapopOnline()
  const versionUrl = `${cdpUrl.replace(/\/$/, "")}/json/version`
  try {
    const response = await fetch(versionUrl, {
      signal: AbortSignal.timeout(3_000),
    })
    if (response.ok) {
      const json = (await response.json()) as { webSocketDebuggerUrl?: string }
      if (json.webSocketDebuggerUrl) {
        const http = new URL(cdpUrl)
        const ws = new URL(json.webSocketDebuggerUrl)
        ws.hostname = http.hostname
        ws.port = http.port
        return await promiseWithin(
          chromium.connectOverCDP(ws.toString()),
          CDP_CONNECT_TIMEOUT_MS,
          "CDP websocket",
        )
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("timed out")) throw error
  }
  return promiseWithin(
    chromium.connectOverCDP(cdpUrl),
    CDP_CONNECT_TIMEOUT_MS,
    "CDP",
  )
}

export async function isCdpListening(cdpUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${cdpUrl.replace(/\/$/, "")}/json/version`, {
      signal: AbortSignal.timeout(1_200),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function quitListeningChrome(port: number): Promise<void> {
  const cdpUrl = cdpUrlForPort(port)
  if (await isCdpListening(cdpUrl)) {
    try {
      const browser = await connectOverCdp(cdpUrl)
      try {
        const closing = browser
          .newBrowserCDPSession()
          .then((session) => session.send("Browser.close"))
        await promiseWithin(closing, QUIT_CLOSE_MS, "Browser.close")
      } catch {
        await promiseWithin(browser.close(), QUIT_CLOSE_MS, "browser.close").catch(() => {})
      }
    } catch {
      // already down
    }
  }
  await killSpawnedChrome(port)
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (!(await isCdpListening(cdpUrl))) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}
