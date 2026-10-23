import { request as httpRequest } from "node:http"
import {
  connect as netConnect,
  createServer,
  type AddressInfo,
  type Server,
  type Socket,
} from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"

import { log } from "../src/lib/log"
import { startAuthForwarder } from "../src/lib/wallapop-cdp/local-proxy"

vi.mock("../src/lib/log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/log")>()
  return { ...actual, log: vi.fn(actual.log) }
})

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo
      resolve(addr.port)
    })
  })
}

/** Upstream proxy that answers 200 to CONNECT and then never closes, not even after the client's FIN. */
async function silentUpstream(closers: Array<() => Promise<void>>): Promise<number> {
  const sockets = new Set<Socket>()
  const upstream = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket)
    socket.once("data", () => socket.write("HTTP/1.1 200 Connection Established\r\n\r\n"))
  })
  const port = await listen(upstream)
  closers.push(
    () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        upstream.close(() => resolve())
      }),
  )
  return port
}

/** Raw CONNECT through the forwarder, like Chrome does. Resolves once the tunnel is up. */
function openTunnel(forwarderPort: number, target: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(forwarderPort, "127.0.0.1", () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`)
    })
    socket.once("data", (chunk) => {
      const head = chunk.toString("latin1")
      if (head.startsWith("HTTP/1.1 200")) resolve(socket)
      else reject(new Error(head))
    })
    socket.once("error", reject)
  })
}

/** close() under a guard, so a hang fails the assertion instead of the test timeout. */
async function closeWithin(close: () => Promise<void>, ms: number): Promise<number | "pending"> {
  const started = Date.now()
  return Promise.race([
    close().then(() => Date.now() - started),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), ms)),
  ])
}

function closeTimeoutReports() {
  return vi
    .mocked(log)
    .mock.calls.filter((call) => call[1] === "wallapop_proxy_close_timeout")
}

describe("startAuthForwarder", () => {
  const closers: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (closers.length) {
      await closers.pop()?.()
    }
    vi.mocked(log).mockClear()
  })

  it("listens on loopback", async () => {
    const fwd = await startAuthForwarder({
      host: "127.0.0.1",
      port: 9,
      username: "proxyuser",
      password: "proxypass",
    })
    closers.push(fwd.close)
    expect(fwd.port).toBeGreaterThan(0)
  })

  it("adds Proxy-Authorization on CONNECT", async () => {
    const expected =
      "Basic " + Buffer.from("proxyuser:proxypass").toString("base64")
    let sawAuth = false
    const upstream = createServer((socket) => {
      let buf = Buffer.alloc(0)
      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk])
        if (!buf.includes("\r\n\r\n")) return
        sawAuth = buf.toString("latin1").includes(`Proxy-Authorization: ${expected}`)
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      })
    })
    const upstreamPort = await listen(upstream)
    closers.push(
      () =>
        new Promise((resolve) => {
          upstream.close(() => resolve())
        }),
    )

    const fwd = await startAuthForwarder({
      host: "127.0.0.1",
      port: upstreamPort,
      username: "proxyuser",
      password: "proxypass",
    })
    closers.push(fwd.close)

    const status = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("CONNECT through local proxy timed out")),
        5_000,
      )
      const req = httpRequest({
        hostname: "127.0.0.1",
        port: fwd.port,
        method: "CONNECT",
        path: "example.com:443",
      })
      req.on("connect", (res) => {
        clearTimeout(timer)
        resolve(res.statusCode ?? 0)
        req.destroy()
      })
      req.on("error", (err) => {
        clearTimeout(timer)
        reject(err)
      })
      req.end()
    })

    expect(sawAuth).toBe(true)
    expect(status).toBe(200)
  })

  it("stops waiting for a tunnel that never closes and reports it", async () => {
    const upstreamPort = await silentUpstream(closers)
    const fwd = await startAuthForwarder({ host: "127.0.0.1", port: upstreamPort }, 200)
    const tunnel = await openTunnel(fwd.port, "example.com:443")
    closers.push(async () => {
      tunnel.destroy()
    })
    const tunnelClosed = new Promise<void>((resolve) => tunnel.once("close", () => resolve()))

    expect(await closeWithin(fwd.close, 3_000)).not.toBe("pending")
    await tunnelClosed
    expect(closeTimeoutReports()).toEqual([
      [
        "warn",
        "wallapop_proxy_close_timeout",
        expect.objectContaining({
          localPort: fwd.port,
          timeoutMs: 200,
          open: 1,
          sockets: [expect.objectContaining({ target: "example.com:443" })],
        }),
      ],
    ])
  })

  it("does not let a half-closed tunnel hold the close", async () => {
    const upstreamPort = await silentUpstream(closers)
    const fwd = await startAuthForwarder({ host: "127.0.0.1", port: upstreamPort }, 200)
    const tunnel = await openTunnel(fwd.port, "example.com:443")
    closers.push(async () => {
      tunnel.destroy()
    })
    tunnel.end()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(await closeWithin(fwd.close, 3_000)).not.toBe("pending")
    const report = closeTimeoutReports()[0]?.[2] as {
      sockets: Array<{ client: object; upstream: object | null }>
    }
    expect(report.sockets[0]).toMatchObject({
      client: { readableEnded: true, writableEnded: false },
      upstream: { writableEnded: true, readableEnded: false },
    })
  })
})
