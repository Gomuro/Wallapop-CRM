import "../load-env"

type Json = Record<string, unknown>

const port = Number(process.env.PORT ?? 4000)
const baseUrl = (
  process.env.API_ORIGIN ?? `http://127.0.0.1:${port}`
).replace(/\/$/, "")
const email = process.env.SEED_USER_EMAIL
const password = process.env.SEED_USER_PASSWORD

if (!email || !password) {
  console.error("SEED_USER_EMAIL and SEED_USER_PASSWORD must be set in server/.env")
  process.exit(1)
}

const jar = new Map<string, string>()

function cookieHeader() {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ")
}

function storeCookies(res: Response) {
  for (const raw of res.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";")
    const eq = pair.indexOf("=")
    if (eq === -1) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    const expired = attrs.some((attr) => {
      const a = attr.trim().toLowerCase()
      return a === "max-age=0" || a.startsWith("max-age=0")
    })
    if (!value || expired) jar.delete(name)
    else jar.set(name, value)
  }
}

async function request(
  method: string,
  path: string,
  options: { json?: unknown; withCookies?: boolean } = {},
) {
  const headers = new Headers()
  if (options.json !== undefined) headers.set("Content-Type", "application/json")
  if (options.withCookies !== false) {
    const cookie = cookieHeader()
    if (cookie) headers.set("Cookie", cookie)
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
  })
  storeCookies(res)
  const text = await res.text()
  let body: Json | string = text
  try {
    body = text ? (JSON.parse(text) as Json) : {}
  } catch {
    body = text
  }
  return { status: res.status, body }
}

function fail(step: string, detail: string): never {
  console.error(`FAIL  ${step} — ${detail}`)
  process.exit(1)
}

function ok(step: string, extra = "") {
  console.log(`PASS  ${step}${extra ? `  ${extra}` : ""}`)
}

function expectStatus(
  step: string,
  got: number,
  want: number,
  body: Json | string,
) {
  if (got !== want) {
    fail(step, `expected HTTP ${want}, got ${got}: ${JSON.stringify(body)}`)
  }
}

function errorCode(body: Json | string) {
  if (typeof body !== "object" || body === null) return undefined
  const error = body.error as { code?: string } | undefined
  return error?.code
}

async function main() {
  console.log(`smoke  ${baseUrl}`)

  try {
    await fetch(`${baseUrl}/health`)
  } catch {
    fail(
      "connect",
      `cannot reach ${baseUrl}. Start Postgres + API: npm run db:up && npm run server:dev`,
    )
  }

  const health = await request("GET", "/health", { withCookies: false })
  expectStatus("GET /health", health.status, 200, health.body)
  ok("GET /health")

  const anon = await request("GET", "/api/v1/products", { withCookies: false })
  expectStatus("GET /api/v1/products (anon)", anon.status, 401, anon.body)
  if (errorCode(anon.body) !== "UNAUTHORIZED") {
    fail("GET /api/v1/products (anon)", "expected error.code UNAUTHORIZED")
  }
  ok("GET /api/v1/products (anon)  401")

  const bad = await request("POST", "/api/v1/auth/login", {
    json: { email, password: "wrong-password" },
    withCookies: false,
  })
  expectStatus("POST /api/v1/auth/login (bad password)", bad.status, 401, bad.body)
  ok("POST /api/v1/auth/login (bad password)  401")

  const login = await request("POST", "/api/v1/auth/login", {
    json: { email, password },
    withCookies: false,
  })
  expectStatus("POST /api/v1/auth/login", login.status, 200, login.body)
  const user = (login.body as Json).user as { email?: string } | undefined
  if (user?.email !== email) {
    fail("POST /api/v1/auth/login", `expected user.email ${email}`)
  }
  if (!jar.has("crm_session")) {
    fail("POST /api/v1/auth/login", "Set-Cookie crm_session missing")
  }
  ok("POST /api/v1/auth/login  cookie crm_session")

  const me = await request("GET", "/api/v1/auth/me")
  expectStatus("GET /api/v1/auth/me", me.status, 200, me.body)
  ok("GET /api/v1/auth/me")

  const products = await request("GET", "/api/v1/products")
  expectStatus("GET /api/v1/products (authed)", products.status, 501, products.body)
  if (errorCode(products.body) !== "NOT_IMPLEMENTED") {
    fail("GET /api/v1/products (authed)", "expected error.code NOT_IMPLEMENTED")
  }
  ok("GET /api/v1/products (authed)  501")

  const logout = await request("POST", "/api/v1/auth/logout")
  expectStatus("POST /api/v1/auth/logout", logout.status, 200, logout.body)
  ok("POST /api/v1/auth/logout")

  const meAfter = await request("GET", "/api/v1/auth/me")
  expectStatus("GET /api/v1/auth/me (after logout)", meAfter.status, 401, meAfter.body)
  ok("GET /api/v1/auth/me (after logout)  401")

  console.log("smoke ok")
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
