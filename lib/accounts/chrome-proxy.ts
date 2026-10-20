/**
 * Chrome --proxy-server does not take user:pass in the URL.
 * Parse operator input; Chrome talks to a local forwarder that adds auth.
 */
export type ChromeProxyConfig = {
  /** `http://host:port` or `socks5://host:port` — no userinfo. */
  server: string
  username?: string
  password?: string
}

export const CHROME_PROXY_PARSE_ERROR =
  "Proxy inválido. Usa http://user:pass@host:port o host:port:user:pass."

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

function asServer(scheme: string, host: string, port: number): string {
  const proto = scheme.replace(/:$/, "")
  return `${proto}://${host}:${port}`
}

function parseHostPort(value: string): { host: string; port: number } | null {
  const match = value.match(/^([^:/]+):(\d{1,5})$/)
  if (!match) return null
  const host = match[1]
  const port = Number(match[2])
  if (!host || !isValidPort(port)) return null
  return { host, port }
}

function fromUrl(raw: string): ChromeProxyConfig | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (!url.hostname) return null
  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : url.protocol === "http:"
        ? 80
        : NaN
  if (!isValidPort(port)) return null
  const username = url.username ? decodeURIComponent(url.username) : undefined
  const password = url.password ? decodeURIComponent(url.password) : undefined
  return {
    server: asServer(url.protocol, url.hostname, port),
    ...(username
      ? { username, password: password ?? "" }
      : {}),
  }
}

function fromUserinfoAtHost(raw: string): ChromeProxyConfig | null {
  const at = raw.lastIndexOf("@")
  if (at <= 0) return null
  const userinfo = raw.slice(0, at)
  const hostport = raw.slice(at + 1)
  const colon = userinfo.indexOf(":")
  if (colon < 0) return null
  const username = userinfo.slice(0, colon)
  const password = userinfo.slice(colon + 1)
  const hp = parseHostPort(hostport)
  if (!hp || !username) return null
  return {
    server: asServer("http", hp.host, hp.port),
    username,
    password,
  }
}

function fromVendor(raw: string): ChromeProxyConfig | null {
  const match = raw.match(/^([^:]+):(\d{1,5}):([^:]+):(.*)$/)
  if (!match) return null
  const host = match[1]
  const port = Number(match[2])
  const username = match[3]
  const password = match[4]
  if (!host || !isValidPort(port) || !username) return null
  return {
    server: asServer("http", host, port),
    username,
    password,
  }
}

/** Accepts `http://user:pass@host:port`, `user:pass@host:port`, `host:port:user:pass`, `host:port`. */
export function parseChromeProxy(
  input: string | null | undefined,
): ChromeProxyConfig | null {
  if (input == null) return null
  const raw = input.trim()
  if (!raw) return null
  if (raw.includes("://")) return fromUrl(raw)
  if (raw.includes("@")) return fromUserinfoAtHost(raw)
  const vendor = fromVendor(raw)
  if (vendor) return vendor
  const hp = parseHostPort(raw)
  if (!hp) return null
  return { server: asServer("http", hp.host, hp.port) }
}
