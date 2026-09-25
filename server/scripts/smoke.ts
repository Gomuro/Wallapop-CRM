import "../load-env"

import sharp from "sharp"

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
  options: {
    json?: unknown
    formData?: FormData
    withCookies?: boolean
  } = {},
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
    body:
      options.formData ??
      (options.json !== undefined ? JSON.stringify(options.json) : undefined),
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

type CategoryRow = { id: string; isLeaf: boolean }

async function findLeafCategoryId(): Promise<string> {
  let parentId = "root"
  for (let depth = 0; depth < 12; depth += 1) {
    const res = await request(
      "GET",
      `/api/v1/categories?parentId=${encodeURIComponent(parentId)}`,
    )
    expectStatus("GET /categories (leaf walk)", res.status, 200, res.body)
    const categories = (res.body as Json).categories as CategoryRow[] | undefined
    if (!Array.isArray(categories) || categories.length === 0) {
      fail("GET /categories (leaf walk)", "no categories in tree")
    }
    const leaf = categories.find((row) => row.isLeaf)
    if (leaf) return leaf.id
    parentId = categories[0].id
  }
  fail("GET /categories (leaf walk)", "could not find leaf category")
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

  const products = await request(
    "GET",
    "/api/v1/products?page=1&pageSize=20",
  )
  expectStatus("GET /api/v1/products (authed)", products.status, 200, products.body)
  if (typeof products.body !== "object" || products.body === null) {
    fail("GET /api/v1/products (authed)", "expected JSON body")
  }
  const list = products.body as Json
  if (!Array.isArray(list.products)) {
    fail("GET /api/v1/products (authed)", "expected products array")
  }
  if (list.page !== 1 || list.pageSize !== 20) {
    fail("GET /api/v1/products (authed)", "expected page=1 pageSize=20")
  }
  if (typeof list.total !== "number" || typeof list.totalPages !== "number") {
    fail("GET /api/v1/products (authed)", "expected total and totalPages")
  }
  ok("GET /api/v1/products (authed)  200")

  const categoryId = await findLeafCategoryId()
  const sku = `SMOKE-${Date.now()}`
  const created = await request("POST", "/api/v1/products", {
    json: {
      sku,
      title: "Smoke photo product",
      description: "Created by server:smoke for #58",
      price: 9.99,
      currency: "EUR",
      categoryId,
      condition: "GOOD",
    },
  })
  expectStatus("POST /api/v1/products (smoke)", created.status, 201, created.body)
  const createdProduct = (created.body as Json).product as { id?: string } | undefined
  if (!createdProduct?.id) {
    fail("POST /api/v1/products (smoke)", "expected product.id")
  }
  const productId = createdProduct.id
  ok("POST /api/v1/products (smoke)", productId)

  const listingGet = await request(
    "GET",
    `/api/v1/products/${productId}/listing`,
  )
  expectStatus(
    "GET /api/v1/products/:id/listing",
    listingGet.status,
    200,
    listingGet.body,
  )
  const listing0 = (listingGet.body as Json).listing as {
    status?: string
    externalUrl?: string | null
  }
  if (listing0?.status !== "READY_TO_POST") {
    fail("GET /api/v1/products/:id/listing", "expected status READY_TO_POST")
  }
  if (listing0?.externalUrl != null) {
    fail("GET /api/v1/products/:id/listing", "expected externalUrl null")
  }
  ok("GET /api/v1/products/:id/listing")

  const wallapopUrl = "https://es.wallapop.com/item/smoke-test"
  const listingPut = await request(
    "PUT",
    `/api/v1/products/${productId}/listing`,
    {
      json: { externalUrl: wallapopUrl, status: "ACTIVE" },
    },
  )
  expectStatus(
    "PUT /api/v1/products/:id/listing",
    listingPut.status,
    200,
    listingPut.body,
  )
  const listing1 = (listingPut.body as Json).listing as {
    status?: string
    externalUrl?: string
  }
  if (listing1?.status !== "ACTIVE" || listing1?.externalUrl !== wallapopUrl) {
    fail("PUT /api/v1/products/:id/listing", "expected ACTIVE and saved URL")
  }
  ok("PUT /api/v1/products/:id/listing")

  const listingGet2 = await request(
    "GET",
    `/api/v1/products/${productId}/listing`,
  )
  expectStatus(
    "GET /api/v1/products/:id/listing (after PUT)",
    listingGet2.status,
    200,
    listingGet2.body,
  )
  const listing2 = (listingGet2.body as Json).listing as {
    status?: string
    externalUrl?: string
  }
  if (listing2?.status !== "ACTIVE" || listing2?.externalUrl !== wallapopUrl) {
    fail(
      "GET /api/v1/products/:id/listing (after PUT)",
      "listing fields mismatch",
    )
  }
  ok("GET /api/v1/products/:id/listing (after PUT)")

  const png = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 20, g: 120, b: 200 },
    },
  })
    .png()
    .toBuffer()
  const form = new FormData()
  form.append(
    "files",
    new Blob([png], { type: "image/png" }),
    "smoke.png",
  )
  const uploaded = await request(
    "POST",
    `/api/v1/products/${productId}/images`,
    { formData: form },
  )
  expectStatus(
    "POST /api/v1/products/:id/images",
    uploaded.status,
    201,
    uploaded.body,
  )
  const withImages = (uploaded.body as Json).product as {
    images?: Array<{ url: string; sortOrder: number }>
  }
  if (!withImages?.images?.length) {
    fail("POST /api/v1/products/:id/images", "expected product.images")
  }
  if (withImages.images[0].sortOrder !== 0) {
    fail("POST /api/v1/products/:id/images", "cover must be sortOrder 0")
  }
  ok("POST /api/v1/products/:id/images")

  const got = await request("GET", `/api/v1/products/${productId}`)
  expectStatus("GET /api/v1/products/:id (after upload)", got.status, 200, got.body)
  const detail = (got.body as Json).product as {
    images?: Array<{ url: string }>
  }
  if (!detail?.images?.length) {
    fail("GET /api/v1/products/:id (after upload)", "expected images on product")
  }
  ok("GET /api/v1/products/:id (after upload)")

  const listAfter = await request(
    "GET",
    `/api/v1/products?page=1&pageSize=50&q=${encodeURIComponent(sku)}`,
  )
  expectStatus("GET /api/v1/products (coverUrl)", listAfter.status, 200, listAfter.body)
  const items = (listAfter.body as Json).products as Array<{ coverUrl?: string | null }>
  if (!items?.[0]?.coverUrl) {
    fail("GET /api/v1/products (coverUrl)", "expected coverUrl after upload")
  }
  ok("GET /api/v1/products (coverUrl)")

  const statusOnCard = await request(
    "PATCH",
    `/api/v1/products/${productId}`,
    { json: { status: "INACTIVE" } },
  )
  expectStatus(
    "PATCH /api/v1/products/:id (reject status on card)",
    statusOnCard.status,
    400,
    statusOnCard.body,
  )
  ok("PATCH /api/v1/products/:id (reject status on card)")

  const inactive = await request(
    "PATCH",
    `/api/v1/products/${productId}/status`,
    { json: { status: "INACTIVE" } },
  )
  expectStatus(
    "PATCH /api/v1/products/:id/status (INACTIVE)",
    inactive.status,
    200,
    inactive.body,
  )
  const inactiveProduct = (inactive.body as Json).product as { status?: string }
  if (inactiveProduct?.status !== "INACTIVE") {
    fail("PATCH /api/v1/products/:id/status (INACTIVE)", "expected status INACTIVE")
  }
  ok("PATCH /api/v1/products/:id/status (INACTIVE)")

  const activeAgain = await request(
    "PATCH",
    `/api/v1/products/${productId}/status`,
    { json: { status: "ACTIVE" } },
  )
  expectStatus(
    "PATCH /api/v1/products/:id/status (ACTIVE)",
    activeAgain.status,
    200,
    activeAgain.body,
  )
  if (
    ((activeAgain.body as Json).product as { status?: string })?.status !== "ACTIVE"
  ) {
    fail("PATCH /api/v1/products/:id/status (ACTIVE)", "expected status ACTIVE")
  }
  ok("PATCH /api/v1/products/:id/status (ACTIVE)")

  const sold = await request("POST", `/api/v1/products/${productId}/sold`)
  expectStatus("POST /api/v1/products/:id/sold", sold.status, 200, sold.body)
  const soldProduct = (sold.body as Json).product as {
    status?: string
    soldAt?: string | null
    soldPrice?: number | null
    listing?: { status?: string } | null
  }
  if (soldProduct?.status !== "SOLD") {
    fail("POST /api/v1/products/:id/sold", "expected status SOLD")
  }
  if (!soldProduct?.soldAt) {
    fail("POST /api/v1/products/:id/sold", "expected soldAt")
  }
  if (soldProduct?.listing?.status !== "DEACTIVATED") {
    fail("POST /api/v1/products/:id/sold", "expected listing DEACTIVATED")
  }
  ok("POST /api/v1/products/:id/sold")

  const listSold = await request(
    "GET",
    `/api/v1/products?page=1&pageSize=50&q=${encodeURIComponent(sku)}`,
  )
  expectStatus("GET /api/v1/products (after sold)", listSold.status, 200, listSold.body)
  const soldListItem = (
    (listSold.body as Json).products as Array<{
      listingActive?: boolean
    }>
  )?.[0]
  if (soldListItem?.listingActive !== false) {
    fail("GET /api/v1/products (after sold)", "expected listingActive false")
  }
  ok("GET /api/v1/products (after sold)  listingActive false")

  const soldAgain = await request("POST", `/api/v1/products/${productId}/sold`)
  expectStatus(
    "POST /api/v1/products/:id/sold (repeat)",
    soldAgain.status,
    409,
    soldAgain.body,
  )
  if (errorCode(soldAgain.body) !== "ALREADY_SOLD") {
    fail("POST /api/v1/products/:id/sold (repeat)", "expected ALREADY_SOLD")
  }
  ok("POST /api/v1/products/:id/sold (repeat)  409 ALREADY_SOLD")

  const removed = await request("DELETE", `/api/v1/products/${productId}`)
  expectStatus("DELETE /api/v1/products/:id (smoke cleanup)", removed.status, 200, removed.body)
  ok("DELETE /api/v1/products/:id (smoke cleanup)")

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
