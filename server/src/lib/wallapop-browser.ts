/**
 * Wallapop email login / 2FA / logout via Chrome CDP.
 * Shared CDP attach: wallapop-cdp.ts. Publish: wallapop-publish.ts.
 */
import type { Page } from "playwright";

import {
  attachOrLaunch,
  BrowserBusyError,
  closeWallapopBrowser,
  connectCdpHandle,
  CDP_URL,
  dismissWallapopConsent,
  firstVisible,
  getBrowserBusy,
  WALLAPOP_CMP_ACCEPT_SELECTORS,
  getWallapopHandle,
  hasOpenWallapopBrowser,
  NAV_TIMEOUT_MS,
  runWithBrowserBusy,
  setWallapopHandle,
} from "./wallapop-cdp";
import { log } from "./log";

export { closeWallapopBrowser, hasOpenWallapopBrowser };

const LOGIN_URL = "https://es.wallapop.com/login";
/** Session probe when Chrome has no Wallapop tab (e.g. New Tab after spawn). */
const PROBE_URL = "https://es.wallapop.com/wall";

/**
 * Email login UI map — повний registry: server/API.md → Accounts →
 * «Email login UI map + selector registry». Тримайте SELECTORS і docs синхронно.
 */
const SELECTORS = {
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
} as const;

export type BrowserLoginOutcome = "ACTIVE" | "REQUIRES_2FA";

async function detect2FA(page: Page): Promise<boolean> {
  return (await firstVisible(page, SELECTORS.otpScreen, 1_500)) != null;
}

async function detectLoggedIn(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (url.includes("accounts.wallapop.com")) return false;
  if (url.includes("/login") || url.includes("/auth/onboarding")) return false;
  if (
    url.includes("/app/") ||
    url.includes("/profile") ||
    url.includes("/wall") ||
    url.includes("/you") ||
    url.includes("/account")
  ) {
    return true;
  }

  if (!url.includes("wallapop.com")) return false;

  if ((await firstVisible(page, SELECTORS.loggedIn, 1_200)) != null) {
    return true;
  }

  const cookies = await page.context().cookies("https://es.wallapop.com");
  const hasSession = cookies.some((cookie) => {
    const name = cookie.name.toLowerCase();
    return (
      name === "accesstoken" ||
      name.includes("access") ||
      name.includes("session-token") ||
      name.includes("session") ||
      name.includes("auth")
    );
  });
  return hasSession;
}

function preferLoggedInPage(pages: Page[], fallback: Page): Page {
  const wall = pages.find((p) => {
    try {
      const url = p.url().toLowerCase();
      return (
        url.includes("es.wallapop.com") &&
        url.includes("/wall") &&
        !url.includes("accounts.wallapop.com")
      );
    } catch {
      return false;
    }
  });
  if (wall) return wall;

  const esHome = pages.find((p) => {
    try {
      const url = p.url().toLowerCase();
      return (
        url.includes("es.wallapop.com") &&
        !url.includes("/login") &&
        !url.includes("/auth/onboarding") &&
        !url.includes("accounts.wallapop.com")
      );
    } catch {
      return false;
    }
  });
  return esHome ?? fallback;
}

async function detectRecaptcha(page: Page): Promise<boolean> {
  return (await firstVisible(page, SELECTORS.recaptcha, 1_500)) != null;
}

async function clickEmailLoginEntry(page: Page): Promise<void> {
  if (await firstVisible(page, SELECTORS.email, 1_500)) return;

  const byRole = page.getByRole("button", {
    name: "Iniciar sesión con email",
  });
  try {
    if (await byRole.isVisible({ timeout: 4_000 })) {
      await byRole.click();
    } else {
      const host = await firstVisible(page, SELECTORS.emailLoginButton, 8_000);
      if (!host) {
        throw new Error(
          'No se encontró el botón "Iniciar sesión con email" en onboarding.',
        );
      }
      await host.click();
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Iniciar sesión con email")
    ) {
      throw error;
    }
    const host = await firstVisible(page, SELECTORS.emailLoginButton, 8_000);
    if (!host) {
      throw new Error(
        'No se encontró el botón "Iniciar sesión con email" en onboarding.',
      );
    }
    await host.click();
  }

  const username = await firstVisible(page, SELECTORS.email, NAV_TIMEOUT_MS);
  if (!username) {
    throw new Error(
      "No apareció el formulario Keycloak (#username) tras elegir email.",
    );
  }
}

async function waitForLoginOutcome(
  page: Page,
  timeoutMs = NAV_TIMEOUT_MS,
): Promise<BrowserLoginOutcome | "FAILED"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const handle = getWallapopHandle();
    const pages = handle?.context.pages() ?? [page];
    for (const p of pages) {
      try {
        if (await detect2FA(p)) {
          if (handle)
            setWallapopHandle({ ...handle, page: p, ownedPage: false });
          return "REQUIRES_2FA";
        }
      } catch {
        // closed tab
      }
    }
    for (const p of pages) {
      try {
        if (await detectLoggedIn(p)) {
          if (handle)
            setWallapopHandle({ ...handle, page: p, ownedPage: false });
          return "ACTIVE";
        }
      } catch {
        // closed tab
      }
    }
    await page.waitForTimeout(500).catch(() => {});
  }

  const handle = getWallapopHandle();
  const pages = handle?.context.pages() ?? [page];
  for (const p of pages) {
    try {
      if (await detect2FA(p)) {
        if (handle) setWallapopHandle({ ...handle, page: p, ownedPage: false });
        return "REQUIRES_2FA";
      }
    } catch {
      // closed
    }
  }
  for (const p of pages) {
    try {
      if (await detectLoggedIn(p)) {
        if (handle) setWallapopHandle({ ...handle, page: p, ownedPage: false });
        return "ACTIVE";
      }
    } catch {
      // closed
    }
  }
  return "FAILED";
}

export async function logoutWallapopInBrowser(): Promise<void> {
  await runWithBrowserBusy("logout", async () => {
    try {
      let handle = getWallapopHandle()
      if (!handle) {
        handle = await connectCdpHandle()
        setWallapopHandle(handle)
        log("info", "wallapop_logout_attached_cdp", { cdpUrl: CDP_URL })
      }

      const { context, page } = handle
      await context.clearCookies()

      await page
        .goto("https://es.wallapop.com/logout", {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT_MS,
        })
        .catch(() => {})

      await page
        .goto(LOGIN_URL, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT_MS,
        })
        .catch(() => {})

      log("info", "wallapop_logout_done", { url: page.url() })
    } catch (error) {
      log("warn", "wallapop_logout_failed", {
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      await closeWallapopBrowser()
    }
  })
}

export type ReconcileBrowserState = "REQUIRES_2FA" | "ACTIVE" | "NONE"

/**
 * After a CDP handle exists: pick MFA/logged-in page and classify.
 * If no Wallapop tab (New Tab etc.), navigate to /wall first so cookies/session can be detected.
 * On NONE closes the browser handle (same as prior reconcile).
 */
async function detectReconcileStateFromHandle(): Promise<ReconcileBrowserState> {
  const handle = getWallapopHandle()
  if (!handle) return "NONE"

  const siblings = handle.context.pages()
  const mfaPage =
    siblings.find((p) => {
      const url = p.url().toLowerCase()
      return (
        url.includes("accounts.wallapop.com") || url.includes("login-actions")
      )
    }) ?? null
  let activePage = mfaPage ?? handle.page
  if (mfaPage && mfaPage !== handle.page) {
    setWallapopHandle({ ...handle, page: mfaPage, ownedPage: false })
  }

  const activeUrl = (() => {
    try {
      return activePage.url().toLowerCase()
    } catch {
      return ""
    }
  })()
  const onWallapop =
    activeUrl.includes("wallapop.com") ||
    activeUrl.includes("login-actions")

  if (!mfaPage && !onWallapop) {
    log("info", "wallapop_browser_reconcile_probe_nav", {
      from: activeUrl || "(unknown)",
      to: PROBE_URL,
    })
    await activePage.goto(PROBE_URL, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    })
    activePage = getWallapopHandle()?.page ?? activePage
  }

  if (!mfaPage) {
    await dismissWallapopConsent(activePage)
  }

  if (await detect2FA(activePage)) {
    log("info", "wallapop_browser_reconcile_mfa", { url: activePage.url() })
    return "REQUIRES_2FA"
  }
  if (await detectLoggedIn(activePage)) {
    log("info", "wallapop_browser_reconcile_active", {
      url: activePage.url(),
    })
    return "ACTIVE"
  }

  await closeWallapopBrowser()
  return "NONE"
}

async function reconcileWithAttach(
  spawnIfNeeded: boolean,
): Promise<ReconcileBrowserState> {
  const busy = getBrowserBusy()
  if (busy !== "idle" && busy !== "rehydrate") {
    log("info", "wallapop_browser_reconcile_skipped_busy", {
      busy,
      spawnIfNeeded,
    })
    return "NONE"
  }

  try {
    let handle = getWallapopHandle()
    if (!handle) {
      handle = spawnIfNeeded
        ? await attachOrLaunch()
        : await connectCdpHandle()
      setWallapopHandle(handle)
      log("info", "wallapop_browser_reconcile_attached", {
        cdpUrl: CDP_URL,
        spawned: spawnIfNeeded,
      })
    }
    return await detectReconcileStateFromHandle()
  } catch (error) {
    log("info", "wallapop_browser_reconcile_none", {
      message: error instanceof Error ? error.message : String(error),
      spawnIfNeeded,
    })
    setWallapopHandle(null)
    return "NONE"
  }
}

/** Attach-only (no Chrome spawn). Used by status / publish gates. */
export async function reconcileWallapopBrowserState(): Promise<ReconcileBrowserState> {
  return reconcileWithAttach(false)
}

/**
 * Boot rehydrate: attach or spawn Chrome on CDP, then classify session.
 * Do not use on every status poll — would relaunch Chrome when disconnected.
 */
export async function reconcileWallapopBrowserStateSpawning(): Promise<ReconcileBrowserState> {
  return reconcileWithAttach(true)
}

export async function loginWallapopInBrowser(input: {
  email: string
  password: string
  proxy?: string | null
}): Promise<BrowserLoginOutcome> {
  return runWithBrowserBusy("login", async () => {
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

      const outcome = await waitForLoginOutcome(page)
      if (outcome === "FAILED") {
        if (await detectRecaptcha(page)) {
          throw new Error(
            "Wallapop muestra reCAPTCHA. Resuélvelo manualmente en Chrome o reintenta más tarde.",
          )
        }
        throw new Error(
          "No se pudo completar el login de Wallapop. Revisa email, contraseña o el DOM.",
        )
      }
      log("info", "wallapop_login_outcome", {
        outcome,
        url: page.url(),
      })
      return outcome
    } catch (error) {
      await closeWallapopBrowser()
      throw error
    }
  })
}

export async function submitWallapop2faInBrowser(
  code: string,
): Promise<BrowserLoginOutcome> {
  // Reconcile/attach while idle — reconcile skips when busy ≠ idle.
  const busyAtStart = getBrowserBusy()
  if (busyAtStart !== "idle") {
    throw new BrowserBusyError(busyAtStart, "login")
  }

  let handle = getWallapopHandle()
  if (!handle?.page) {
    const reconciled = await reconcileWallapopBrowserState()
    handle = getWallapopHandle()
    if (reconciled !== "REQUIRES_2FA" || !handle?.page) {
      const busyAfter = getBrowserBusy()
      if (busyAfter !== "idle") {
        throw new BrowserBusyError(busyAfter, "login")
      }
      throw new Error("No hay una sesión de autenticación activa.")
    }
  }

  return runWithBrowserBusy("login", async () => {
    handle = getWallapopHandle()
    if (!handle?.page) {
      throw new Error("No hay una sesión de autenticación activa.")
    }

    let page = handle.page
    if (!(await detect2FA(page))) {
      throw new Error(
        "La pantalla 2FA ya no está disponible. Reintenta el login.",
      )
    }

    const otpInput = await firstVisible(page, SELECTORS.otp, 10_000)
    if (!otpInput) {
      throw new Error(
        "No se encontró el campo del código 2FA (data-input-otp / mfa_code).",
      )
    }
    const trimmed = code.trim()
    await otpInput.fill(trimmed)

    try {
      const hidden = page.locator('input[name="mfa_code"]').first()
      if (await hidden.isVisible({ timeout: 800 }).catch(() => false)) {
        await hidden.fill(trimmed, { timeout: 1_500 }).catch(() => {})
      }
    } catch {
      // page may have navigated away already
    }

    if (!(await detect2FA(page))) {
      const outcome = await waitForLoginOutcome(page)
      if (outcome === "FAILED") {
        throw new Error("No se pudo verificar el código 2FA.")
      }
      if (outcome === "REQUIRES_2FA") {
        throw new Error("Código 2FA incorrecto o aún pendiente.")
      }
      return outcome
    }

    try {
      const submit = await firstVisible(page, SELECTORS.otpSubmit, 5_000)
      if (submit) {
        await submit.click({ timeout: 5_000 })
      } else {
        await otpInput.press("Enter")
      }
    } catch {
      // Navigation during click is fine — fall through to outcome.
    }

    handle = getWallapopHandle()
    if (handle) {
      page = preferLoggedInPage(handle.context.pages(), handle.page)
      setWallapopHandle({ ...handle, page, ownedPage: false })
    }

    const outcome = await waitForLoginOutcome(page)
    if (outcome === "FAILED") {
      throw new Error("No se pudo verificar el código 2FA.")
    }
    if (outcome === "REQUIRES_2FA") {
      throw new Error("Código 2FA incorrecto o aún pendiente.")
    }
    return outcome
  })
}
