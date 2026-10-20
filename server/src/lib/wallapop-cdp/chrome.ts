/**
 * Spawn and stop the real Google Chrome process for a CDP port.
 */
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import {
  FIRST_ACCOUNT_CDP_PORT,
  FIRST_ACCOUNT_PROFILE_NAME,
  firstCdpPort,
} from "../../../../lib/accounts/chrome-place"
import {
  parseChromeProxy,
  type ChromeProxyConfig,
} from "../../../../lib/accounts/chrome-proxy"
import { log } from "../log"
import { ensureLocalProxy, stopLocalProxy } from "./local-proxy"

const DEFAULT_CDP_PORT = firstCdpPort()
const ACCOUNT_WINDOW_WIDTH = 1440
const ACCOUNT_WINDOW_HEIGHT = 900

function profileDirForPort(port: number): string {
  if (port === DEFAULT_CDP_PORT && process.env.WALLAPOP_CHROME_USER_DATA_DIR?.trim()) {
    return process.env.WALLAPOP_CHROME_USER_DATA_DIR.trim()
  }
  const name =
    port === FIRST_ACCOUNT_CDP_PORT
      ? FIRST_ACCOUNT_PROFILE_NAME
      : `ChromeCDP-${port}`
  return path.resolve(process.env.USERPROFILE ?? "", name)
}

const CHROME_LAUNCH_EXTRA_ARGS = [
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--no-first-run",
  "--no-default-browser-check",
  `--window-size=${ACCOUNT_WINDOW_WIDTH},${ACCOUNT_WINDOW_HEIGHT}`,
  "--window-position=0,0",
] as const

/** Chrome process we spawned for a port. Profile stays on disk after quit. */
const chromeProcesses = new Map<number, ChildProcess>
/** Last connect proxy for this Chrome slot (workers relaunch with it). */
const proxyByPort = new Map<number, ChromeProxyConfig | null>()
const PROXY_FILE = "wallapop-chrome-proxy.json"

function persistPath(port: number): string {
  return path.join(profileDirForPort(port), PROXY_FILE)
}

export function rememberChromeProxy(
  port: number,
  input: string | null | undefined,
): ChromeProxyConfig | null {
  const parsed = parseChromeProxy(input ?? null)
  proxyByPort.set(port, parsed)
  const file = persistPath(port)
  try {
    if (!parsed) {
      fs.unlinkSync(file)
    } else {
      fs.mkdirSync(profileDirForPort(port), { recursive: true })
      fs.writeFileSync(
        file,
        JSON.stringify({
          server: parsed.server,
          username: parsed.username ?? null,
          password: parsed.password ?? null,
        }),
      )
    }
  } catch (error) {
    if (parsed || fs.existsSync(file)) {
      log("warn", "wallapop_chrome_proxy_persist_failed", {
        port,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return parsed
}

export function chromeProxyForPort(port: number): ChromeProxyConfig | null {
  if (proxyByPort.has(port)) return proxyByPort.get(port) ?? null
  try {
    const raw = JSON.parse(fs.readFileSync(persistPath(port), "utf8")) as {
      server?: string
      username?: string | null
      password?: string | null
    }
    if (typeof raw.server !== "string" || !raw.server.trim()) return null
    const config: ChromeProxyConfig = {
      server: raw.server.trim(),
      ...(raw.username
        ? { username: raw.username, password: raw.password ?? "" }
        : {}),
    }
    proxyByPort.set(port, config)
    return config
  } catch {
    return null
  }
}

function findChromeExecutable(): string {
  const fromEnv = process.env.WALLAPOP_CHROME_PATH?.trim()
  const candidates = [
    fromEnv,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA
      ? path.join(
          process.env.LOCALAPPDATA,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : null,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  throw new Error(
    "No se encontró Google Chrome. Instálalo o define WALLAPOP_CHROME_PATH.",
  )
}

async function appendProxyArgs(
  args: string[],
  port: number,
  proxy?: string | null,
): Promise<string | null> {
  if (proxy !== undefined) rememberChromeProxy(port, proxy)
  const proxyConfig = chromeProxyForPort(port)
  if (proxyConfig?.username) {
    const proxyServer = await ensureLocalProxy(port, proxyConfig)
    args.push(`--proxy-server=${proxyServer}`)
    args.push("--proxy-bypass-list=<-loopback>")
    return proxyServer
  }
  await stopLocalProxy(port)
  if (!proxyConfig) return null
  args.push(`--proxy-server=${proxyConfig.server}`)
  return proxyConfig.server
}

export async function spawnRealChrome(
  proxy?: string | null,
  port = DEFAULT_CDP_PORT,
): Promise<ChildProcess> {
  const chromePath = findChromeExecutable()
  const profileDir = profileDirForPort(port)
  fs.mkdirSync(profileDir, { recursive: true })

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--remote-allow-origins=*",
    ...CHROME_LAUNCH_EXTRA_ARGS,
  ]
  const proxyServer = await appendProxyArgs(args, port, proxy)
  const proxyConfig = chromeProxyForPort(port)

  log("info", "wallapop_chrome_spawning", {
    chromePath,
    profileDir,
    cdpPort: port,
    proxyServer,
    proxyAuth: Boolean(proxyConfig?.username),
    proxyUpstream: proxyConfig?.server ?? null,
  })

  const child = spawn(chromePath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  })
  child.unref()
  chromeProcesses.set(port, child)
  return child
}

function taskkillPid(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    })
    const timer = setTimeout(resolve, 5_000)
    killer.on("exit", () => {
      clearTimeout(timer)
      resolve()
    })
    killer.on("error", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

export async function killSpawnedChrome(port = DEFAULT_CDP_PORT): Promise<void> {
  await stopLocalProxy(port)
  const child = chromeProcesses.get(port) ?? null
  chromeProcesses.delete(port)
  if (child?.pid == null) return
  try {
    if (process.platform === "win32") {
      await taskkillPid(child.pid)
    } else {
      try {
        process.kill(child.pid, "SIGTERM")
      } catch {
        child.kill("SIGTERM")
      }
    }
    log("info", "wallapop_chrome_process_killed", { pid: child.pid, port })
  } catch (error) {
    log("warn", "wallapop_chrome_process_kill_failed", {
      pid: child.pid,
      port,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
