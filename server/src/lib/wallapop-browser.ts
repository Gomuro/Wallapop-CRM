import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

import { log } from "./log";

/** CDP endpoint of the real Chrome we attach to (and may start ourselves). */
const CDP_URL = process.env.WALLAPOP_CDP_URL ?? "http://127.0.0.1:9222";
const CDP_PORT = Number(process.env.WALLAPOP_CDP_PORT ?? "9222");
/**
 * Same profile as the "Chrome CDP" desktop shortcut — history, cookies, Google account.
 * Override with WALLAPOP_CHROME_USER_DATA_DIR if needed.
 */
const PROFILE_DIR =
  process.env.WALLAPOP_CHROME_USER_DATA_DIR?.trim() ||
  path.resolve(process.env.USERPROFILE ?? "", "ChromeCDP-Persistent");
const LOGIN_URL = "https://es.wallapop.com/login";
const NAV_TIMEOUT_MS = 45_000;
const ACTION_TIMEOUT_MS = 20_000;
const CDP_READY_TIMEOUT_MS = 30_000;

/** Extra flags from the Chrome CDP.lnk shortcut (stability while automated). */
const CHROME_LAUNCH_EXTRA_ARGS = [
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--no-first-run",
  "--no-default-browser-check",
] as const;

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
  cookieAccept: [
    // consentmanager.net CMP (Wallapop welcome GDPR) — <a>, not <button>
    "#cmpwelcomebtnyes a.cmpboxbtnyes",
    "#cmpwelcomebtnyes a",
    "a.cmpboxbtnyes",
    "#cmpbntyestxt",
    'a.cmpboxbtn:has-text("Accept all")',
    'a.cmpboxbtn:has-text("Aceptar todo")',
    'a.cmpboxbtn:has-text("Aceptar todas")',
    // legacy / OneTrust / generic
    'button:has-text("Aceptar todas")',
    'button:has-text("Accept all")',
    'button:has-text("Aceptar")',
    'button:has-text("Accept")',
    "#onetrust-accept-btn-handler",
  ],
  recaptcha: [
    'iframe[src*="recaptcha"]',
    "#id-recaptcha-token",
    ".g-recaptcha",
  ],
  /** Logged-in home — server/API.md «Logged-in success markers». */
  loggedIn: [
    'img[data-testid="user-avatar"]',
    '[data-testid="section-inview-feed"]',
  ],
} as const;

export type BrowserLoginOutcome = "ACTIVE" | "REQUIRES_2FA";

type BrowserHandle = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** True if we opened a new tab; false if we reused an existing Chrome tab. */
  ownedPage: boolean;
};

let handle: BrowserHandle | null = null;
/** Chrome process we spawned; left running after disconnect (profile stays warm). */
let chromeProcess: ChildProcess | null = null;

function findChromeExecutable(): string {
  const fromEnv = process.env.WALLAPOP_CHROME_PATH?.trim();
  const candidates = [
    fromEnv,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA
      ? path.join(
          process.env.LOCALAPPDATA,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : null,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    "No se encontró Google Chrome. Instálalo o define WALLAPOP_CHROME_PATH.",
  );
}

async function waitForCdp(cdpUrl: string, timeoutMs = CDP_READY_TIMEOUT_MS) {
  const versionUrl = `${cdpUrl.replace(/\/$/, "")}/json/version`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(versionUrl, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Chrome CDP no respondió en ${cdpUrl}. ¿Arrancó Chrome con --remote-debugging-port=${CDP_PORT}?`,
  );
}

function spawnRealChrome(proxy?: string | null): ChildProcess {
  const chromePath = findChromeExecutable();
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    ...CHROME_LAUNCH_EXTRA_ARGS,
  ];
  const proxyServer = proxy?.trim();
  if (proxyServer) {
    args.push(`--proxy-server=${proxyServer}`);
  }

  log("info", "wallapop_chrome_spawning", {
    chromePath,
    profileDir: PROFILE_DIR,
    cdpPort: CDP_PORT,
  });

  const child = spawn(chromePath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  chromeProcess = child;
  return child;
}

async function firstVisible(
  page: Page,
  selectors: readonly string[],
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      try {
        if (await locator.isVisible({ timeout: 400 })) {
          return locator;
        }
      } catch {
        // try next
      }
    }
    await page.waitForTimeout(250);
  }
  return null;
}

async function dismissCookies(page: Page): Promise<void> {
  // CMP can paint after first paint — give it a moment.
  const btn = await firstVisible(page, SELECTORS.cookieAccept, 5_000);
  if (!btn) return;
  try {
    await btn.click({ timeout: 3_000 });
    // Wait for overlay to leave so it doesn't block login clicks.
    await page
      .locator("#cmpbox")
      .waitFor({ state: "hidden", timeout: 5_000 })
      .catch(() => {});
  } catch {
    // ignore
  }
}

async function detect2FA(page: Page): Promise<boolean> {
  // Structural markers from Wallapop MFA screen (not copy — text can change).
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

/** Prefer es.wallapop.com/wall (or other logged-in tab) over stale accounts MFA tab. */
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
  // Already on Keycloak form.
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
    const pages = handle?.context.pages() ?? [page];
    for (const p of pages) {
      try {
        if (await detect2FA(p)) {
          if (handle) handle = { ...handle, page: p, ownedPage: false };
          return "REQUIRES_2FA";
        }
      } catch {
        // closed tab
      }
    }
    for (const p of pages) {
      try {
        if (await detectLoggedIn(p)) {
          if (handle) handle = { ...handle, page: p, ownedPage: false };
          return "ACTIVE";
        }
      } catch {
        // closed tab
      }
    }
    await page.waitForTimeout(500).catch(() => {});
  }

  const pages = handle?.context.pages() ?? [page];
  for (const p of pages) {
    try {
      if (await detect2FA(p)) {
        if (handle) handle = { ...handle, page: p, ownedPage: false };
        return "REQUIRES_2FA";
      }
    } catch {
      // closed
    }
  }
  for (const p of pages) {
    try {
      if (await detectLoggedIn(p)) {
        if (handle) handle = { ...handle, page: p, ownedPage: false };
        return "ACTIVE";
      }
    } catch {
      // closed
    }
  }
  return "FAILED";
}

/**
 * Disconnect Playwright from Chrome.
 * Does NOT quit Chrome — so the profile (and a later re-attach) stay available.
 */
export async function closeWallapopBrowser(): Promise<void> {
  const current = handle;
  handle = null;
  if (!current) return;
  try {
    if (current.ownedPage) {
      await current.page.close().catch(() => {});
    }
    // connectOverCDP: close() disconnects automation, Chrome keeps running.
    await current.browser.close();
  } catch (error) {
    log("warn", "wallapop_browser_close_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export function hasOpenWallapopBrowser(): boolean {
  return handle != null;
}

/**
 * Full Wallapop logout in the persistent Chrome profile (cookies + /logout).
 * Does not quit Chrome. If CDP is down, returns without throwing (CRM still disconnects).
 */
export async function logoutWallapopInBrowser(): Promise<void> {
  try {
    if (!handle) {
      handle = await connectCdpHandle();
      log("info", "wallapop_logout_attached_cdp", { cdpUrl: CDP_URL });
    }

    const { context, page } = handle;
    await context.clearCookies();

    await page
      .goto("https://es.wallapop.com/logout", {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      })
      .catch(() => {});

    await page
      .goto(LOGIN_URL, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      })
      .catch(() => {});

    log("info", "wallapop_logout_done", { url: page.url() });
  } catch (error) {
    log("warn", "wallapop_logout_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await closeWallapopBrowser();
  }
}

async function connectCdpHandle(): Promise<BrowserHandle> {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const pages = context.pages();
  const preferred =
    pages.find((p) => {
      const url = p.url().toLowerCase();
      return (
        url.includes("accounts.wallapop.com") || url.includes("login-actions")
      );
    }) ??
    pages.find((p) => p.url().toLowerCase().includes("wallapop.com")) ??
    pages[0];
  const ownedPage = !preferred;
  const page = preferred ?? (await context.newPage());
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  return { browser, context, page, ownedPage };
}

export type ReconcileBrowserState = "REQUIRES_2FA" | "ACTIVE" | "NONE";

/**
 * Re-attach to an already-running Chrome (CDP only, no spawn) and infer
 * login/MFA state from the live DOM. Used after API restart so 2FA can continue.
 */
export async function reconcileWallapopBrowserState(): Promise<ReconcileBrowserState> {
  try {
    if (!handle) {
      handle = await connectCdpHandle();
      log("info", "wallapop_browser_reconcile_attached", { cdpUrl: CDP_URL });
    }

    const { page } = handle;

    // Prefer MFA / accounts tab if several pages are open.
    const siblings = handle.context.pages();
    const mfaPage =
      siblings.find((p) => {
        const url = p.url().toLowerCase();
        return (
          url.includes("accounts.wallapop.com") || url.includes("login-actions")
        );
      }) ?? null;
    const activePage = mfaPage ?? page;
    if (mfaPage && mfaPage !== handle.page) {
      handle = { ...handle, page: mfaPage, ownedPage: false };
    }

    if (await detect2FA(activePage)) {
      log("info", "wallapop_browser_reconcile_mfa", { url: activePage.url() });
      return "REQUIRES_2FA";
    }
    if (await detectLoggedIn(activePage)) {
      log("info", "wallapop_browser_reconcile_active", {
        url: activePage.url(),
      });
      return "ACTIVE";
    }

    await closeWallapopBrowser();
    return "NONE";
  } catch (error) {
    log("info", "wallapop_browser_reconcile_none", {
      message: error instanceof Error ? error.message : String(error),
    });
    handle = null;
    return "NONE";
  }
}

/**
 * 1) Attach to Chrome already listening on CDP.
 * 2) If closed — start real Google Chrome ourselves (headed, profiles/account_1, :9222), then attach.
 */
async function attachOrLaunch(
  proxyInput?: string | null,
): Promise<BrowserHandle> {
  try {
    const attached = await connectCdpHandle();
    log("info", "wallapop_browser_attached_cdp", { cdpUrl: CDP_URL });
    return attached;
  } catch (error) {
    log("info", "wallapop_cdp_not_ready_launching_chrome", {
      cdpUrl: CDP_URL,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  spawnRealChrome(proxyInput);
  await waitForCdp(CDP_URL);
  const attached = await connectCdpHandle();
  log("info", "wallapop_browser_attached_after_spawn", { cdpUrl: CDP_URL });
  return attached;
}

/**
 * Open Chrome (CDP attach or spawn profile), then run email login:
 * onboarding → «Iniciar sesión con email» → Keycloak fill → submit.
 */
export async function loginWallapopInBrowser(input: {
  email: string;
  password: string;
  proxy?: string | null;
}): Promise<BrowserLoginOutcome> {
  await closeWallapopBrowser();
  handle = await attachOrLaunch(input.proxy);
  const { page } = handle;

  try {
    await page.goto(LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    await dismissCookies(page);

    if (await detectLoggedIn(page)) {
      log("info", "wallapop_already_logged_in", { url: page.url() });
      return "ACTIVE";
    }

    await clickEmailLoginEntry(page);
    await dismissCookies(page);

    const emailInput = await firstVisible(page, SELECTORS.email, 10_000);
    if (!emailInput) {
      throw new Error("No se encontró el campo de email (#username).");
    }
    await emailInput.fill(input.email);

    const passwordInput = await firstVisible(page, SELECTORS.password, 10_000);
    if (!passwordInput) {
      throw new Error("No se encontró el campo de contraseña (#password).");
    }
    await passwordInput.fill(input.password);

    const submit = await firstVisible(page, SELECTORS.submit, 10_000);
    if (!submit) {
      throw new Error(
        'No se encontró el botón "Acceder a Wallapop" (#kc-login).',
      );
    }
    await submit.click();

    const outcome = await waitForLoginOutcome(page);
    if (outcome === "FAILED") {
      if (await detectRecaptcha(page)) {
        throw new Error(
          "Wallapop muestra reCAPTCHA. Resuélvelo manualmente en Chrome o reintenta más tarde.",
        );
      }
      throw new Error(
        "No se pudo completar el login de Wallapop. Revisa email, contraseña o el DOM.",
      );
    }
    log("info", "wallapop_login_outcome", {
      outcome,
      url: page.url(),
    });
    return outcome;
  } catch (error) {
    await closeWallapopBrowser();
    throw error;
  }
}

export async function submitWallapop2faInBrowser(
  code: string,
): Promise<BrowserLoginOutcome> {
  if (!handle?.page) {
    const reconciled = await reconcileWallapopBrowserState();
    if (reconciled !== "REQUIRES_2FA" || !handle?.page) {
      throw new Error("No hay una sesión de autenticación activa.");
    }
  }

  let page = handle.page;

  const otpInput = await firstVisible(page, SELECTORS.otp, 10_000);
  if (!otpInput) {
    throw new Error(
      "No se encontró el campo del código 2FA (data-input-otp / mfa_code).",
    );
  }
  const trimmed = code.trim();
  await otpInput.fill(trimmed);

  // Sync hidden field only while MFA DOM still exists — never block 20s after redirect.
  try {
    const hidden = page.locator('input[name="mfa_code"]').first();
    if (await hidden.isVisible({ timeout: 800 }).catch(() => false)) {
      await hidden.fill(trimmed, { timeout: 1_500 }).catch(() => {});
    }
  } catch {
    // page may have navigated away already
  }

  // Auto-submit / redirect may already have left MFA.
  if (!(await detect2FA(page))) {
    const outcome = await waitForLoginOutcome(page);
    if (outcome === "FAILED") {
      throw new Error("No se pudo verificar el código 2FA.");
    }
    if (outcome === "REQUIRES_2FA") {
      throw new Error("Código 2FA incorrecto o aún pendiente.");
    }
    return outcome;
  }

  try {
    const submit = await firstVisible(page, SELECTORS.otpSubmit, 5_000);
    if (submit) {
      await submit.click({ timeout: 5_000 });
    } else {
      await otpInput.press("Enter");
    }
  } catch {
    // Navigation during click is fine — fall through to outcome.
  }

  if (handle) {
    page = preferLoggedInPage(handle.context.pages(), handle.page);
    handle = { ...handle, page, ownedPage: false };
  }

  const outcome = await waitForLoginOutcome(page);
  if (outcome === "FAILED") {
    throw new Error("No se pudo verificar el código 2FA.");
  }
  if (outcome === "REQUIRES_2FA") {
    throw new Error("Código 2FA incorrecto o aún pendiente.");
  }
  return outcome;
}
