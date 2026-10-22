import fs from "node:fs"
import path from "node:path"

import { chromium, type Page } from "playwright"
import { describe, expect, it } from "vitest"

import { classifyLoginFailure } from "../src/lib/wallapop-browser/login-signals"

const FIXTURE = path.join(__dirname, "fixtures/wallapop-login-rejected.html")

const INVISIBLE_RECAPTCHA = `
  <div class="g-recaptcha" data-size="invisible" data-action="login"></div>
  <iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?k=x"></iframe>`

const KC_ERROR = `<script>const kcContext = { "message": { "summary": "x", "type": "error", "error": true } };</script>`
const KC_CLEAN = `<script>const kcContext = { "message": null };</script>`
const SNACKBAR = `<walla-snackbar><span slot="text">El email y/o la contraseña son incorrectos. Revísalos y vuelve a intentarlo.</span></walla-snackbar>`

async function signalFor(html: string): Promise<string | null> {
  const browser = await chromium.launch({ headless: true })
  try {
    const page: Page = await browser.newPage()
    await page.route("http*://**", (route) => route.abort())
    await page.setContent(html, { waitUntil: "domcontentloaded" })
    const signal = await classifyLoginFailure(page)
    return signal?.signal ?? null
  } finally {
    await browser.close()
  }
}

describe("classifyLoginFailure", () => {
  it("reports LOGIN_REJECTED, not reCAPTCHA, on a wrong-password page", async () => {
    const html = `<body>${INVISIBLE_RECAPTCHA}${SNACKBAR}${KC_ERROR}</body>`
    expect(await signalFor(html)).toBe("LOGIN_REJECTED")
  })

  it("reads kcContext when the snackbar is already gone", async () => {
    expect(await signalFor(`<body>${INVISIBLE_RECAPTCHA}${KC_ERROR}</body>`)).toBe(
      "LOGIN_REJECTED",
    )
  })

  it("reads the snackbar when kcContext is missing", async () => {
    expect(await signalFor(`<body>${INVISIBLE_RECAPTCHA}${SNACKBAR}</body>`)).toBe(
      "LOGIN_REJECTED",
    )
  })

  it("gives no signal for the invisible reCAPTCHA alone", async () => {
    expect(await signalFor(`<body>${INVISIBLE_RECAPTCHA}${KC_CLEAN}</body>`)).toBeNull()
  })

  it("keeps the reCAPTCHA signal off while the challenge selector is unverified", async () => {
    const challenge = `<iframe src="https://www.google.com/recaptcha/api2/bframe?k=x" style="width:400px;height:500px"></iframe>`
    expect(await signalFor(`<body>${challenge}${KC_CLEAN}</body>`)).toBeNull()
  })

  it.skipIf(!fs.existsSync(FIXTURE))(
    "reports LOGIN_REJECTED on the saved real login page",
    async () => {
      expect(await signalFor(fs.readFileSync(FIXTURE, "utf8"))).toBe("LOGIN_REJECTED")
    },
  )
})
