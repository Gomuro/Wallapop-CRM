/**
 * Chrome cannot put user:pass on --proxy-server. Listen on 127.0.0.1
 * without auth and add Proxy-Authorization when talking upstream.
 */
import {
  createServer as createHttpServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { connect as netConnect, type Socket } from "node:net"
import type { Duplex } from "node:stream"

import type { ChromeProxyConfig } from "../../../../lib/accounts/chrome-proxy"
import { log } from "../log"

export type ProxyUpstream = {
  host: string
  port: number
  username?: string
  password?: string
}

type Forwarder = {
  port: number
  close: () => Promise<void>
}

const forwarders = new Map<number, Forwarder>()

function proxyAuthorization(up: ProxyUpstream): string | undefined {
  if (!up.username) return undefined
  return `Basic ${Buffer.from(`${up.username}:${up.password ?? ""}`).toString("base64")}`
}

function upstreamFromConfig(config: ChromeProxyConfig): ProxyUpstream {
  const url = new URL(config.server)
  return {
    host: url.hostname,
    port: Number(url.port),
    username: config.username,
    password: config.password,
  }
}

function headerEndIndex(buf: Buffer): number {
  const crlf = buf.indexOf("\r\n\r\n")
  if (crlf !== -1) return crlf + 4
  const lf = buf.indexOf("\n\n")
  if (lf !== -1) return lf + 2
  return -1
}

function pipeHttp(
  clientReq: IncomingMessage,
  clientRes: ServerResponse,
  up: ProxyUpstream,
  auth: string | undefined,
) {
  const headers = { ...clientReq.headers }
  if (auth) headers["proxy-authorization"] = auth
  delete headers["proxy-connection"]
  const proxyReq = httpRequest({
    hostname: up.host,
    port: up.port,
    method: clientReq.method,
    path: clientReq.url,
    headers,
  })
  proxyReq.on("response", (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
    proxyRes.pipe(clientRes)
  })
  proxyReq.on("error", () => {
    if (!clientRes.headersSent) clientRes.writeHead(502)
    clientRes.end()
  })
  clientReq.pipe(proxyReq)
}

function relayConnectHeaders(input: {
  buf: Buffer
  upstreamSocket: Socket
  clientSocket: Duplex
  up: ProxyUpstream
  onData: (chunk: Buffer) => void
}) {
  const end = headerEndIndex(input.buf)
  if (end === -1) return false
  input.upstreamSocket.off("data", input.onData)
  const header = input.buf.subarray(0, end).toString("latin1")
  const rest = input.buf.subarray(end)
  const status = /^HTTP\/\d(?:\.\d)?\s+(\d+)/i.exec(header)
  const code = status ? Number(status[1]) : 502
  if (code >= 200 && code < 300) {
    input.clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    if (rest.length) input.clientSocket.write(rest)
    input.upstreamSocket.pipe(input.clientSocket)
    input.clientSocket.pipe(input.upstreamSocket)
    return true
  }
  log("warn", "wallapop_local_proxy_connect_rejected", {
    upstreamHost: input.up.host,
    upstreamPort: input.up.port,
    status: code,
  })
  input.clientSocket.write(`HTTP/1.1 ${code} Proxy Error\r\nConnection: close\r\n\r\n`)
  input.clientSocket.end()
  input.upstreamSocket.end()
  return true
}

function openConnectTunnel(input: {
  req: IncomingMessage
  clientSocket: Duplex
  head: Buffer
  up: ProxyUpstream
  auth: string | undefined
}) {
  const { req, clientSocket, head, up, auth } = input
  const target = req.url ?? ""
  const upstreamSocket = netConnect(up.port, up.host, () => {
    const lines = [`CONNECT ${target} HTTP/1.1`, `Host: ${target}`]
    if (auth) lines.push(`Proxy-Authorization: ${auth}`)
    lines.push("Proxy-Connection: Keep-Alive", "", "")
    upstreamSocket.write(lines.join("\r\n"))
    if (head.length) upstreamSocket.write(head)
    let buf = Buffer.alloc(0)
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      relayConnectHeaders({ buf, upstreamSocket, clientSocket, up, onData })
    }
    upstreamSocket.on("data", onData)
  })
  upstreamSocket.on("error", () => {
    if (!clientSocket.destroyed) {
      clientSocket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
      clientSocket.end()
    }
  })
  clientSocket.on("error", () => upstreamSocket.destroy())
}

export function startAuthForwarder(up: ProxyUpstream): Promise<Forwarder> {
  return new Promise((resolve, reject) => {
    const auth = proxyAuthorization(up)
    const server = createHttpServer((clientReq, clientRes) => {
      pipeHttp(clientReq, clientRes, up, auth)
    })
    server.on("connect", (req, clientSocket, head) => {
      openConnectTunnel({ req, clientSocket, head, up, auth })
    })
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      if (!addr || typeof addr === "string") {
        reject(new Error("No se pudo abrir el proxy local."))
        return
      }
      resolve({
        port: addr.port,
        close: () =>
          new Promise((done) => {
            server.close(() => done())
          }),
      })
    })
  })
}

export function hasLocalProxy(cdpPort: number): boolean {
  return forwarders.has(cdpPort)
}

export async function ensureLocalProxy(
  cdpPort: number,
  config: ChromeProxyConfig,
): Promise<string> {
  const previous = forwarders.get(cdpPort)
  if (previous) {
    forwarders.delete(cdpPort)
    await previous.close().catch(() => {})
  }
  const forwarder = await startAuthForwarder(upstreamFromConfig(config))
  forwarders.set(cdpPort, forwarder)
  log("info", "wallapop_local_proxy_listening", {
    cdpPort,
    localPort: forwarder.port,
    upstreamHost: new URL(config.server).hostname,
    upstreamPort: Number(new URL(config.server).port),
  })
  return `http://127.0.0.1:${forwarder.port}`
}

export async function stopLocalProxy(cdpPort: number): Promise<void> {
  const previous = forwarders.get(cdpPort)
  if (!previous) return
  forwarders.delete(cdpPort)
  await previous.close().catch(() => {})
}
