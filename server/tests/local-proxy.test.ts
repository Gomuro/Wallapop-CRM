import { request as httpRequest } from "node:http"
import {
  createServer,
  type AddressInfo,
  type Server,
} from "node:net"
import { afterEach, describe, expect, it } from "vitest"

import { startAuthForwarder } from "../src/lib/wallapop-cdp/local-proxy"

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo
      resolve(addr.port)
    })
  })
}

describe("startAuthForwarder", () => {
  const closers: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (closers.length) {
      await closers.pop()?.()
    }
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
})
