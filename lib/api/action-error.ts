export function isNextRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  )
}

export function actionFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "")
  if (/unexpected response was received from the server/i.test(message)) {
    return "No se ha podido completar la acción. Las fotos pueden ser demasiado pesadas o el servidor no ha respondido. Inténtalo de nuevo."
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "No se ha podido conectar con el servidor. Inténtalo de nuevo."
  }
  if (/413|too large|entity too large/i.test(message)) {
    return "Las fotos son demasiado pesadas. Reduce el tamaño e inténtalo de nuevo."
  }
  return "No se ha podido completar la acción. Inténtalo de nuevo."
}
