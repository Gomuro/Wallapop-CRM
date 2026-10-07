"use client";

import {
  ConnectResetDialog,
  ConnectTwoFaDialog,
} from "@/components/accounts/connect-account-dialogs";
import { useConnectAccountSession } from "@/components/accounts/connect-account-session";
import { ConnectLoginForm } from "@/components/accounts/connect-login-form";
import { Badge } from "@/components/ui/badge";
import { type WallapopConnectionStatus } from "@/lib/api/wallapop-account";

const STATUS_LABEL: Record<WallapopConnectionStatus, string> = {
  DISCONNECTED: "No conectado",
  AUTHENTICATING: "Autenticando",
  ACTIVE: "Activo",
};

function statusBadgeVariant(
  status: WallapopConnectionStatus,
): "outline" | "secondary" | "default" {
  if (status === "ACTIVE") return "default";
  if (status === "AUTHENTICATING") return "secondary";
  return "outline";
}

export function ConnectAccountForm() {
  const session = useConnectAccountSession();
  const {
    apiReady,
    session: account,
    statusLoading,
    connectedEmail,
    isActive,
    isAuthenticating,
    error,
    listingsResetNotice,
    showConnectHint,
  } = session;

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Cuenta Wallapop
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Conecta el email de Wallapop (Chrome + login automático).
          </p>
        </div>
        <Badge variant={statusBadgeVariant(account.status)}>
          {statusLoading ? "…" : STATUS_LABEL[account.status]}
        </Badge>
      </div>

      {!apiReady ? (
        <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
          La API no está configurada en este entorno. La conexión no funcionará
          hasta que se defina NEXT_PUBLIC_API_PROXY o NEXT_PUBLIC_API_URL.
        </p>
      ) : null}

      {connectedEmail && isActive ? (
        <p className="mb-4 text-sm text-muted-foreground">
          Sesión: <span className="text-foreground">{connectedEmail}</span>
        </p>
      ) : null}

      {connectedEmail && isAuthenticating ? (
        <p className="mb-4 text-sm text-muted-foreground">
          Intentando: <span className="text-foreground">{connectedEmail}</span>
        </p>
      ) : null}

      {error ? (
        <p
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {listingsResetNotice ? (
        <p
          className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm font-semibold text-destructive"
          role="status"
        >
          Esta cuenta de Wallapop es distinta a la anterior. Los estados de
          publicación del CRM se han restablecido a «Listo para publicar» y se
          han olvidado los enlaces. Los anuncios en Wallapop no se han borrado.
        </p>
      ) : null}

      {showConnectHint ? (
        <p
          className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
          aria-live="polite"
        >
          Abriendo Chrome y completando el login…
        </p>
      ) : null}

      <ConnectLoginForm session={session} />
      <ConnectResetDialog session={session} />
      <ConnectTwoFaDialog session={session} />
    </div>
  );
}
