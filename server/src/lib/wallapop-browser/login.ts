/**
 * Wallapop email login via Chrome CDP.
 */
import type { Page } from "playwright"

import {
  attachOrLaunch,
  closeWallapopBrowser,
  dismissWallapopConsent,
  firstVisible,
  getWallapopHandle,
  NAV_TIMEOUT_MS,
  runWithBrowserBusy,
  setWallapopHandle,
  WALLAPOP_CMP_ACCEPT_SELECTORS,
} from "../wallapop-cdp"
import { log } from "../log"

const LOGIN_URL = "https://es.wallapop.com/login"

/**
 * Email login UI map — повний registry: server/API.md → Accounts →
 * «Email login UI map + selector registry». Тримайте SELECTORS і docs синхронно.
 */
export const SELECTORS = {
  emailLoginButton: ['walla-button[text="Iniciar sesión con email"]'],
  email: [
    "#username",
    'input[name="username"]',
    'input[type="email"]',
    'input[autocomplete="username"]',
  ],
  password: [
    "#password",
    'input[name="password"]',
    'input[type="password"]',
    'input[autocomplete="current-password"]',
  ],
  submit: [
    "#kc-login",
    "walla-button#kc-login",
    'button:has-text("Acceder a Wallapop")',
    'button[type="submit"]',
  ],
  /** SMS MFA screen (Keycloak login-actions) — prefer structure over copy. */
  otp: [
    'input[data-input-otp="true"]',
    'input[name="mfa_code"]',
    'input[autocomplete="one-time-code"]',
  ],
  otpScreen: [
    "#mfa-code-validation-form",
    'form[id="mfa-code-validation-form"]',
    '[data-input-otp-container="true"]',
    'input[name="mfa_code"]',
    'input[data-input-otp="true"]',
  ],
  otpSubmit: [
    '#mfa-code-validation-form walla-button[behaviour-type="submit"]',
    'walla-button[behaviour-type="submit"][text="Verificar"]',
    'walla-button[text="Verificar"]',
  ],
  cookieAccept: [...WALLAPOP_CMP_ACCEPT_SELECTORS],
  recaptcha: [
    'iframe[src*="recaptcha"]',
    "#id-recaptcha-token",
    ".g-recaptcha",
  ],
  loggedIn: [
    'img[data-testid="user-avatar"]',
    '[data-testid="section-inview-feed"]',
  ],
} as const

export type BrowserLoginOutcome = "ACTIVE" | "REQUIRES_2FA"

export async function detect2FA(page: Page): Promise<boolean> {
  return (await firstVisible(page, SELECTORS.otpScreen, 1_500)) != null
}

export async function detectLoggedIn(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase()
  if (url.includes("accounts.wallapop.com")) return false
  if (url.includes("/login") || url.includes("/auth/onboarding")) return false
  if (
    url.includes("/app/") ||
    url.includes("/profile") ||
    url.includes("/wall") ||
    url.includes("/you") ||
    url.includes("/account")
  ) {
    return true
  }

  if (!url.includes("wallapop.com")) return false

  if ((await firstVisible(page, SELECTORS.loggedIn, 1_200)) != null) {
    return true
  }

  const cookies = await page.context().cookies("https://es.wallapop.com")
  const hasSession = cookies.some((cookie) => {
    const name = cookie.name.toLowerCase()
    return (
      name === "accesstoken" ||
      name.includes("access") ||
      name.includes("session-token") ||
      name.includes("session") ||
      name.includes("auth")
    )
  })
  return hasSession
}

async function detectRecaptcha(page: Page): Promise<boolean> {
  return (await firstVisible(page, SELECTORS.recaptcha, 1_500)) != null
}

async function clickEmailLoginEntry(page: Page): Promise<void> {
  if (await firstVisible(page, SELECTORS.email, 1_500)) return

  const byRole = page.getByRole("button", {
    name: "Iniciar sesión con email",
  })
  try {
    if (await byRole.isVisible({ timeout: 4_000 })) {
      await byRole.click()
    } else {
      const host = await firstVisible(page, SELECTORS.emailLoginButton, 8_000)
      if (!host) {
        throw new Error(
          'No se encontró el botón "Iniciar sesión con email" en onboarding.',
        )
      }
      await host.click()
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Iniciar sesión con email")
    ) {
      throw error
    }
    const host = await firstVisible(page, SELECTORS.emailLoginButton, 8_000)
    if (!host) {
      throw new Error(
        'No se encontró el botón "Iniciar sesión con email" en onboarding.',
      )
    }
    await host.click()
  }

  const username = await firstVisible(page, SELECTORS.email, NAV_TIMEOUT_MS)
  if (!username) {
    throw new Error(
      "No apareció el formulario Keycloak (#username) tras elegir email.",
    )
  }
}

async function scanPagesForOutcome(
  pages: Page[],
  detect: (p: Page) => Promise<boolean>,
  outcome: BrowserLoginOutcome,
): Promise<BrowserLoginOutcome | null> {
  const handle = getWallapopHandle()
  for (const p of pages) {
    try {
      if (await detect(p)) {
        if (handle) setWallapopHandle({ ...handle, page: p, ownedPage: false })
        return outcome
      }
    } catch {
      // closed tab
    }
  }
  return null
}

async function classifyLoginPages(
  page: Page,
): Promise<BrowserLoginOutcome | null> {
  const handle = getWallapopHandle()
  const pages = handle?.context.pages() ?? [page]
  return (
    (await scanPagesForOutcome(pages, detect2FA, "REQUIRES_2FA")) ??
    (await scanPagesForOutcome(pages, detectLoggedIn, "ACTIVE"))
  )
}

export async function waitForLoginOutcome(
  page: Page,
  timeoutMs = NAV_TIMEOUT_MS,
): Promise<BrowserLoginOutcome | "FAILED"> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await classifyLoginPages(page)
    if (found) return found
    await page.waitForTimeout(500).catch(() => {})
  }
  return (await classifyLoginPages(page)) ?? "FAILED"
}

async function fillWallapopLoginForm(
  page: Page,
  input: { email: string; password: string },
): Promise<void> {
  const emailInput = await firstVisible(page, SELECTORS.email, 10_000)
  if (!emailInput) {
    throw new Error("No se encontró el campo de email (#username).")
  }
  await emailInput.fill(input.email)
  const passwordInput = await firstVisible(page, SELECTORS.password, 10_000)
  if (!passwordInput) {
    throw new Error("No se encontró el campo de contraseña (#password).")
  }
  await passwordInput.fill(input.password)
  const submit = await firstVisible(page, SELECTORS.submit, 10_000)
  if (!submit) {
    throw new Error(
      'No se encontró el botón "Acceder a Wallapop" (#kc-login).',
    )
  }
  await submit.click()
}

async function resolveLoginOutcome(page: Page): Promise<BrowserLoginOutcome> {
  const outcome = await waitForLoginOutcome(page)
  if (outcome !== "FAILED") return outcome
  if (await detectRecaptcha(page)) {
    throw new Error(
      "Wallapop muestra reCAPTCHA. Resuélvelo manualmente en Chrome o reintenta más tarde.",
    )
  }
  throw new Error(
    "No se pudo completar el login de Wallapop. Revisa email, contraseña o el DOM.",
  )
}

async function runWallapopEmailLogin(input: {
  email: string
  password: string
  proxy?: string | null
}): Promise<BrowserLoginOutcome> {
  await closeWallapopBrowser()
  const attached = await attachOrLaunch(input.proxy)
  setWallapopHandle(attached)
  const { page } = attached
  try {
    await page.goto(LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    })
    await dismissWallapopConsent(page)
    if (await detectLoggedIn(page)) {
      log("info", "wallapop_already_logged_in", { url: page.url() })
      return "ACTIVE"
    }
    await clickEmailLoginEntry(page)
    await dismissWallapopConsent(page)
    await fillWallapopLoginForm(page, input)
    const outcome = await resolveLoginOutcome(page)
    log("info", "wallapop_login_outcome", { outcome, url: page.url() })
    return outcome
  } catch (error) {
    await closeWallapopBrowser()
    throw error
  }
}

export async function loginWallapopInBrowser(input: {
  email: string
  password: string
  proxy?: string | null
}): Promise<BrowserLoginOutcome> {
  return runWithBrowserBusy("login", () => runWallapopEmailLogin(input))
}
