"use client";

import { useEffect, useRef, useState } from "react";
import { EyeIcon, EyeOffIcon, Link2Icon, LoaderCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isApiConfigured } from "@/lib/api/config";
import {
  connectWallapopAccount,
  disconnectWallapopAccount,
  getWallapopAccountStatus,
  submitWallapop2fa,
  wallapopAccountErrorMessage,
  type WallapopAccountSession,
  type WallapopConnectionStatus,
} from "@/lib/api/wallapop-account";

const STATUS_LABEL: Record<WallapopConnectionStatus, string> = {
  DISCONNECTED: "No conectado",
  AUTHENTICATING: "Autenticando",
  ACTIVE: "Activo",
};

type PendingKind = "connect" | "2fa" | "disconnect" | null;
type ResetMode = "disconnect" | "cancel";

function statusBadgeVariant(
  status: WallapopConnectionStatus,
): "outline" | "secondary" | "default" {
  if (status === "ACTIVE") return "default";
  if (status === "AUTHENTICATING") return "secondary";
  return "outline";
}

export function ConnectAccountForm() {
  const apiReady = isApiConfigured();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [proxy, setProxy] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [session, setSession] = useState<WallapopAccountSession>({
    status: "DISCONNECTED",
    requires2FA: false,
    email: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<PendingKind>(null);
  const [twoFaOpen, setTwoFaOpen] = useState(false);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [statusLoading, setStatusLoading] = useState(true);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [resetMode, setResetMode] = useState<ResetMode>("cancel");
  const [listingsResetNotice, setListingsResetNotice] = useState(false);
  const connectRequestIdRef = useRef(0);
  const twoFaRequestIdRef = useRef(0);
  const pendingKindRef = useRef<PendingKind>(null);
  pendingKindRef.current = pendingKind;

  const resetBusy = pendingKind === "disconnect";

  useEffect(() => {
    if (!apiReady) {
      setStatusLoading(false);
      return;
    }

    let cancelled = false;

    async function refreshStatus(options?: { initial?: boolean }) {
      if (pendingKindRef.current !== null) return;
      if (options?.initial) setStatusLoading(true);
      try {
        const next = await getWallapopAccountStatus();
        if (cancelled) return;
        setSession(next);
        if (next.requires2FA) setTwoFaOpen(true);
        if (
          next.status === "ACTIVE" &&
          next.email &&
          pendingKindRef.current === null
        ) {
          setEmail((current) => (current.trim() ? current : next.email!));
        }
      } catch {
        if (!cancelled) {
          setSession({
            status: "DISCONNECTED",
            requires2FA: false,
            email: null,
          });
        }
      } finally {
        if (!cancelled && options?.initial) setStatusLoading(false);
      }
    }

    void refreshStatus({ initial: true });

    function onVisibility() {
      if (document.visibilityState === "visible") {
        void refreshStatus();
      }
    }
    function onFocus() {
      void refreshStatus();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [apiReady]);

  useEffect(() => {
    if (
      disconnectConfirmOpen &&
      session.status === "ACTIVE" &&
      resetMode === "cancel"
    ) {
      setDisconnectConfirmOpen(false);
    }
  }, [disconnectConfirmOpen, session.status, resetMode]);

  async function onConnect(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Introduce el email y la contraseña de Wallapop.");
      return;
    }

    const requestId = ++connectRequestIdRef.current;
    setPendingKind("connect");
    setSession({
      status: "AUTHENTICATING",
      requires2FA: false,
      email: trimmedEmail,
    });
    try {
      const next = await connectWallapopAccount({
        email: trimmedEmail,
        password,
        proxy,
      });
      if (requestId !== connectRequestIdRef.current) return;
      setSession(next);
      if (next.listingsReset) setListingsResetNotice(true);
      if (next.requires2FA) {
        setTwoFaOpen(true);
        setTwoFaCode("");
      }
    } catch (err) {
      if (requestId !== connectRequestIdRef.current) return;
      setError(wallapopAccountErrorMessage(err));
      setSession({
        status: "DISCONNECTED",
        requires2FA: false,
        email: null,
      });
      setTwoFaOpen(false);
    } finally {
      if (requestId === connectRequestIdRef.current) {
        setPendingKind((kind) => (kind === "connect" ? null : kind));
      }
    }
  }

  async function onSubmit2fa(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const code = twoFaCode.trim();
    if (code.length < 4) {
      setError("Introduce el código 2FA.");
      return;
    }

    const requestId = ++twoFaRequestIdRef.current;
    setPendingKind("2fa");
    try {
      const next = await submitWallapop2fa(code);
      if (requestId !== twoFaRequestIdRef.current) return;
      setSession(next);
      if (next.listingsReset) setListingsResetNotice(true);
      if (next.status === "ACTIVE") {
        setTwoFaOpen(false);
        setTwoFaCode("");
        setPassword("");
      } else if (next.requires2FA) {
        setTwoFaOpen(true);
      }
    } catch (err) {
      if (requestId !== twoFaRequestIdRef.current) return;
      setError(wallapopAccountErrorMessage(err));
    } finally {
      if (requestId === twoFaRequestIdRef.current) {
        setPendingKind((kind) => (kind === "2fa" ? null : kind));
      }
    }
  }

  async function onDisconnect() {
    setError(null);
    setDisconnectConfirmOpen(false);
    connectRequestIdRef.current += 1;
    twoFaRequestIdRef.current += 1;
    setPendingKind("disconnect");
    try {
      const next = await disconnectWallapopAccount();
      setSession(next);
      setTwoFaOpen(false);
      setTwoFaCode("");
    } catch (err) {
      setError(wallapopAccountErrorMessage(err));
    } finally {
      setPendingKind(null);
    }
  }

  function openResetConfirm(mode: ResetMode) {
    if (resetBusy) return;
    setResetMode(mode);
    setTwoFaOpen(false);
    setDisconnectConfirmOpen(true);
  }

  function requestDisconnect() {
    if (resetBusy) return;
    openResetConfirm(session.status === "ACTIVE" ? "disconnect" : "cancel");
  }

  const connectedEmail = session.email;
  const isActive = session.status === "ACTIVE";
  const isAuthenticating = session.status === "AUTHENTICATING";
  const isDisconnected = session.status === "DISCONNECTED";
  const showSessionReset = isActive || isAuthenticating;
  const showConnectHint = pendingKind === "connect" && !twoFaOpen;

  const resetPendingLabel =
    resetMode === "disconnect" ? "Desconectando…" : "Cancelando…";
  const resetIdleLabel = isActive ? "Desconectar" : "Cancelar";
  const resetConfirmTitle =
    resetMode === "disconnect"
      ? "¿Desconectar la cuenta?"
      : "¿Cancelar el intento de conexión?";
  const resetConfirmDescription =
    resetMode === "disconnect"
      ? "Se cerrará la sesión de Wallapop en Chrome. Tendrás que volver a iniciar sesión."
      : "Se abortará el login en curso y se cerrará Chrome. Podrás intentarlo de nuevo.";
  const resetConfirmAction =
    resetMode === "disconnect" ? "Desconectar" : "Cancelar intento";

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
        <Badge variant={statusBadgeVariant(session.status)}>
          {statusLoading ? "…" : STATUS_LABEL[session.status]}
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

      <form onSubmit={onConnect} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="wallapop-email">Email</Label>
          <Input
            id="wallapop-email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            className="h-12 text-base md:h-10 md:text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={
              !apiReady ||
              !isDisconnected ||
              pendingKind === "connect" ||
              resetBusy
            }
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="wallapop-password">Contraseña</Label>
          <div className="relative">
            <Input
              id="wallapop-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              className="h-12 pr-11 text-base md:h-10 md:text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={
                !apiReady ||
                !isDisconnected ||
                pendingKind === "connect" ||
                resetBusy
              }
              required
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={
                showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
              }
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="wallapop-proxy">
            Proxy{" "}
            <span className="font-normal text-muted-foreground">
              (opcional)
            </span>
          </Label>
          <Input
            id="wallapop-proxy"
            name="proxy"
            type="text"
            placeholder="http://user:pass@host:port"
            autoComplete="off"
            className="h-12 text-base md:h-10 md:text-sm"
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
            disabled={
              !apiReady ||
              !isDisconnected ||
              pendingKind === "connect" ||
              resetBusy
            }
          />
        </div>

        <div className="flex flex-col gap-2 pt-1">
          {isDisconnected ? (
            <Button
              type="submit"
              className="h-12 w-full"
              disabled={!apiReady || pendingKind === "connect" || resetBusy}
              aria-busy={pendingKind === "connect" || undefined}
            >
              {pendingKind === "connect" ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <Link2Icon />
              )}
              {pendingKind === "connect" ? "Conectando…" : "Conectar cuenta"}
            </Button>
          ) : null}

          {showSessionReset ? (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full"
              disabled={!apiReady || resetBusy}
              onClick={requestDisconnect}
              aria-busy={resetBusy || undefined}
            >
              {resetBusy ? <LoaderCircleIcon className="animate-spin" /> : null}
              {resetBusy
                ? isActive
                  ? "Desconectando…"
                  : "Cancelando…"
                : resetIdleLabel}
            </Button>
          ) : null}
        </div>
      </form>

      <Dialog
        open={disconnectConfirmOpen}
        onOpenChange={(open) => {
          if (!resetBusy) setDisconnectConfirmOpen(open);
        }}
      >
        <DialogContent showCloseButton={!resetBusy}>
          <DialogHeader>
            <DialogTitle>{resetConfirmTitle}</DialogTitle>
            <DialogDescription>{resetConfirmDescription}</DialogDescription>
          </DialogHeader>
          {resetMode === "disconnect" ? (
            <p
              className="text-sm font-bold uppercase leading-snug text-destructive"
              role="note"
            >
              Si más tarde inicias sesión con otra cuenta de Wallapop, los
              estados de publicación de este CRM se resetearán a «Listo para
              publicar» y se olvidarán los enlaces. Los anuncios en Wallapop no
              se borran. El mismo email conserva los estados.
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full sm:w-auto"
              disabled={resetBusy}
              onClick={() => setDisconnectConfirmOpen(false)}
            >
              Volver
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11 w-full sm:w-auto"
              disabled={resetBusy}
              onClick={() => void onDisconnect()}
            >
              {resetBusy ? <LoaderCircleIcon className="animate-spin" /> : null}
              {resetBusy ? resetPendingLabel : resetConfirmAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={twoFaOpen}
        onOpenChange={(open) => {
          if (pendingKind === "2fa" || resetBusy) return;
          if (!open) {
            openResetConfirm("cancel");
            return;
          }
          setTwoFaOpen(true);
        }}
      >
        <DialogContent showCloseButton={pendingKind !== "2fa" && !resetBusy}>
          <form onSubmit={onSubmit2fa} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Código 2FA</DialogTitle>
              <DialogDescription>
                Wallapop pide un código de verificación. Introdúcelo para
                completar la conexión.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="wallapop-2fa">Código</Label>
              <Input
                id="wallapop-2fa"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="h-12 text-base tracking-widest md:h-10 md:text-sm"
                value={twoFaCode}
                onChange={(e) => setTwoFaCode(e.target.value)}
                disabled={pendingKind === "2fa" || resetBusy}
                maxLength={8}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full sm:w-auto"
                disabled={pendingKind === "2fa" || resetBusy}
                onClick={() => openResetConfirm("cancel")}
              >
                Cancelar intento
              </Button>
              <Button
                type="submit"
                className="h-11 w-full sm:w-auto"
                disabled={pendingKind === "2fa" || resetBusy}
                aria-busy={pendingKind === "2fa" || undefined}
              >
                {pendingKind === "2fa" ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : null}
                {pendingKind === "2fa" ? "Verificando…" : "Confirmar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
