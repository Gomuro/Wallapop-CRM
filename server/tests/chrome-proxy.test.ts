import { describe, expect, it } from "vitest"

import { parseChromeProxy } from "../../lib/accounts/chrome-proxy"
import {
  wallapopConnectSchema,
  wallapopProxySchema,
} from "../../lib/validations/account"

describe("parseChromeProxy", () => {
  it("parses vendor host:port:user:pass", () => {
    expect(parseChromeProxy("89.32.167.113:12323:proxyuser:proxypass")).toEqual({
      server: "http://89.32.167.113:12323",
      username: "proxyuser",
      password: "proxypass",
    })
  })

  it("parses http://user:pass@host:port", () => {
    expect(
      parseChromeProxy("http://proxyuser:proxypass@89.32.167.113:12323"),
    ).toEqual({
      server: "http://89.32.167.113:12323",
      username: "proxyuser",
      password: "proxypass",
    })
  })

  it("parses user:pass@host:port without scheme", () => {
    expect(parseChromeProxy("proxyuser:proxypass@10.0.0.1:8080")).toEqual({
      server: "http://10.0.0.1:8080",
      username: "proxyuser",
      password: "proxypass",
    })
  })

  it("parses host:port without auth", () => {
    expect(parseChromeProxy("10.0.0.1:8080")).toEqual({
      server: "http://10.0.0.1:8080",
    })
  })

  it("keeps password after the third colon", () => {
    expect(parseChromeProxy("10.0.0.1:8080:user:p:ass:1")).toEqual({
      server: "http://10.0.0.1:8080",
      username: "user",
      password: "p:ass:1",
    })
  })

  it("returns null for empty or junk", () => {
    expect(parseChromeProxy("")).toBeNull()
    expect(parseChromeProxy("   ")).toBeNull()
    expect(parseChromeProxy("not-a-proxy")).toBeNull()
  })
})

describe("wallapopConnectSchema proxy", () => {
  const base = {
    email: "seller@example.com",
    password: "secret",
  }

  it("accepts vendor proxy format", () => {
    const parsed = wallapopConnectSchema.parse({
      ...base,
      proxy: "89.32.167.113:12323:proxyuser:proxypass",
    })
    expect(parsed.proxy).toBe("89.32.167.113:12323:proxyuser:proxypass")
  })

  it("rejects invalid proxy", () => {
    expect(() =>
      wallapopConnectSchema.parse({ ...base, proxy: "not-a-proxy" }),
    ).toThrow(/Proxy inválido/)
  })
})

describe("wallapopProxySchema", () => {
  it("accepts vendor format without login", () => {
    const parsed = wallapopProxySchema.parse({
      proxy: "89.32.167.113:12323:proxyuser:proxypass",
    })
    expect(parsed.proxy).toBe("89.32.167.113:12323:proxyuser:proxypass")
  })
})
