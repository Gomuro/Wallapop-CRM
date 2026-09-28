"use client";

import { useEffect, useState } from "react";
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

  const pending = pendingKind != null;

  useEffect(() => {
    let cancelled = false;
    if (!apiReady) {
      setStatusLoading(false);
      return;
    }
    getWallapopAccountStatus()
      .then((next) => {
        if (cancelled) return;
        setSession(next);
        if (next.requires2FA) setTwoFaOpen(true);
      })
      .catch(() => {
        if (!cancelled) {
          setSession({
            status: "DISCONNECTED",
            requires2FA: false,
            email: null,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiReady]);

  async function onConnect(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Introduce el email y la contraseña de Wallapop.");
      return;
    }

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
      setSession(next);
      if (next.requires2FA) {
        setTwoFaOpen(true);
        setTwoFaCode("");
      }
    } catch (err) {
      setError(wallapopAccountErrorMessage(err));
      setSession({
        status: "DISCONNECTED",
        requires2FA: false,
        email: null,
      });
      setTwoFaOpen(false);
    } finally {
      setPendingKind(null);
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

    setPendingKind("2fa");
    try {
      const next = await submitWallapop2fa(code);
      setSession(next);
      if (next.status === "ACTIVE") {
        setTwoFaOpen(false);
        setTwoFaCode("");
        setPassword("");
      } else if (next.requires2FA) {
        setTwoFaOpen(true);
      }
    } catch (err) {
      setError(wallapopAccountErrorMessage(err));
    } finally {
      setPendingKind(null);
    }
  }

  async function onDisconnect() {
    setError(null);
    setDisconnectConfirmOpen(false);
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

  function requestDisconnect() {
    if (pending) return;
    setDisconnectConfirmOpen(true);
  }

  const connectedEmail = session.email;
  const showDisconnect = session.status !== "DISCONNECTED";
  const showConnectHint =
    pendingKind === "connect" && !twoFaOpen;

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

      {connectedEmail && session.status !== "DISCONNECTED" ? (
        <p className="mb-4 text-sm text-muted-foreground">
          Sesión: <span className="text-foreground">{connectedEmail}</span>
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
            disabled={pending || !apiReady || session.status === "ACTIVE"}
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
              disabled={pending || !apiReady || session.status === "ACTIVE"}
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
            disabled={pending || !apiReady || session.status === "ACTIVE"}
          />
        </div>

        <div className="flex flex-col gap-2 pt-1">
          {session.status !== "ACTIVE" ? (
            <Button
              type="submit"
              className="h-12 w-full"
              disabled={pending || !apiReady}
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

          {showDisconnect ? (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full"
              disabled={pending || !apiReady}
              onClick={requestDisconnect}
              aria-busy={pendingKind === "disconnect" || undefined}
            >
              {pendingKind === "disconnect" ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : null}
              {pendingKind === "disconnect" ? "Desconectando…" : "Desconectar"}
            </Button>
          ) : null}
        </div>
      </form>

      <Dialog
        open={disconnectConfirmOpen}
        onOpenChange={(open) => {
          if (!pending) setDisconnectConfirmOpen(open);
        }}
      >
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>¿Desconectar la cuenta?</DialogTitle>
            <DialogDescription>
              Se cerrará la sesión de Wallapop en Chrome. Tendrás que volver a
              iniciar sesión.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full sm:w-auto"
              disabled={pending}
              onClick={() => setDisconnectConfirmOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11 w-full sm:w-auto"
              disabled={pending}
              onClick={() => void onDisconnect()}
            >
              {pendingKind === "disconnect" ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : null}
              Desconectar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={twoFaOpen}
        onOpenChange={(open) => {
          if (!pending) setTwoFaOpen(open);
        }}
      >
        <DialogContent showCloseButton={!pending}>
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
                disabled={pending}
                maxLength={8}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                className="h-11 w-full sm:w-auto"
                disabled={pending}
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
