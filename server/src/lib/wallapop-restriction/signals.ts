export type RestrictionSignal =
  | "FORCED_SIGNOUT"
  | "LOGIN_RECAPTCHA"
  | "LOGIN_REJECTED"
  | "UNSEEN_PUBLICATIONS"

/** Shown to the operator. A hint, never a verdict. */
export const RESTRICTION_REASONS: Record<RestrictionSignal, string> = {
  FORCED_SIGNOUT:
    "Wallapop cerró la sesión durante la publicación (auth/signout).",
  LOGIN_RECAPTCHA:
    "Wallapop pide reCAPTCHA al iniciar sesión con esta cuenta.",
  LOGIN_REJECTED:
    "Wallapop rechaza el email o la contraseña de esta cuenta, que ya funcionaban.",
  UNSEEN_PUBLICATIONS:
    "Varios anuncios publicados seguidos no aparecieron en el catálogo.",
}

/**
 * Wallapop login error, e.g. «El email y/o la contraseña son incorrectos.
 * Revísalos y vuelve a intentarlo.» Also matches the shorter wording.
 */
export const REJECTED_CREDENTIALS_PATTERN =
  /email\s+y\/o\s+(?:la\s+)?contraseña\s+(?:son\s+|es\s+)?incorrect/i

/** Login page showed a restriction hint. Thrown by the browser login flow. */
export class LoginSignalError extends Error {
  readonly signal: Extract<RestrictionSignal, "LOGIN_RECAPTCHA" | "LOGIN_REJECTED">
  constructor(
    signal: LoginSignalError["signal"],
    message: string,
  ) {
    super(message)
    this.name = "LoginSignalError"
    this.signal = signal
  }
}

export function restrictionBlockMessage(reason: string | null): string {
  const why = reason ? ` Motivo: ${reason}` : ""
  return `Autopost bloqueado: se sospecha una restricción de la cuenta de Wallapop.${why} Revisa la cuenta y descarta el aviso para continuar.`
}
