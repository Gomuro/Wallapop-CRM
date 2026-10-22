import type { Page } from "playwright"

import {
  LoginSignalError,
  REJECTED_CREDENTIALS_PATTERN,
} from "../wallapop-restriction"

/** Keycloak page context, present only inside the browser page. */
declare const kcContext:
  | { message?: { error?: boolean } }
  | undefined

/**
 * The login page always carries an invisible reCAPTCHA (badge iframe
 * `recaptcha/api2/anchor`, `div.g-recaptcha[data-size=invisible]`), so its
 * presence says nothing. Only a visible challenge would, and that selector is
 * not verified against a real challenge page yet. Keep the signal off until a
 * saved challenge HTML confirms it.
 */
export const RECAPTCHA_CHALLENGE_SIGNAL_ENABLED = false

/**
 * Reading Keycloak's `kcContext` is sturdier than the snackbar: the snackbar
 * disappears, the inline script object stays. `const` at top level is a global
 * binding, not a `window` property, hence the bare identifier.
 */
export async function loginRejectedByContext(page: Page): Promise<boolean> {
  return page
    .evaluate(
      () =>
        typeof kcContext !== "undefined" && kcContext?.message?.error === true,
    )
    .catch(() => false)
}

async function loginRejectedBySnackbar(page: Page): Promise<boolean> {
  const count = await page
    .locator("walla-snackbar")
    .filter({ hasText: REJECTED_CREDENTIALS_PATTERN })
    .count()
    .catch(() => 0)
  return count > 0
}

export async function detectLoginRejection(page: Page): Promise<boolean> {
  return (await loginRejectedByContext(page)) || (await loginRejectedBySnackbar(page))
}

/**
 * The challenge popup is the `bframe` iframe (the badge is `anchor`). Google
 * keeps it in a hidden container and shows it only when a challenge is needed.
 */
export async function detectRecaptchaChallenge(page: Page): Promise<boolean> {
  if (!RECAPTCHA_CHALLENGE_SIGNAL_ENABLED) return false
  return page
    .locator('iframe[src*="recaptcha/api2/bframe"]')
    .first()
    .isVisible()
    .catch(() => false)
}

/** Rejected data wins over reCAPTCHA: the badge is on the page every time. */
export async function classifyLoginFailure(
  page: Page,
): Promise<LoginSignalError | null> {
  if (await detectLoginRejection(page)) {
    return new LoginSignalError(
      "LOGIN_REJECTED",
      "Wallapop rechaza el email o la contraseña. Revisa los datos.",
    )
  }
  if (await detectRecaptchaChallenge(page)) {
    return new LoginSignalError(
      "LOGIN_RECAPTCHA",
      "Wallapop muestra reCAPTCHA. Resuélvelo manualmente en Chrome o reintenta más tarde.",
    )
  }
  return null
}
