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

type ConnectSessionSetters = {
  setEmail: React.Dispatch<React.SetStateAction<string>>;
  setPassword: React.Dispatch<React.SetStateAction<string>>;
  setSession: React.Dispatch<React.SetStateAction<WallapopAccountSession>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setPendingKind: React.Dispatch<React.SetStateAction<PendingKind>>;
  setTwoFaOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTwoFaCode: React.Dispatch<React.SetStateAction<string>>;
  setStatusLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setDisconnectConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setListingsResetNotice: React.Dispatch<React.SetStateAction<boolean>>;
};

function attachWallapopStatusSync(ctx: {
  pendingKindRef: React.MutableRefObject<PendingKind>;
  resetModeRef: React.MutableRefObject<ResetMode>;
  setters: ConnectSessionSetters;
}) {
  const { pendingKindRef, resetModeRef, setters } = ctx;
  let cancelled = false;

  async function refreshStatus(options?: { initial?: boolean }) {
    if (pendingKindRef.current !== null) return;
    if (options?.initial) setters.setStatusLoading(true);
    try {
      const next = await getWallapopAccountStatus();
      if (cancelled) return;
      setters.setSession(next);
      if (next.status === "ACTIVE" && resetModeRef.current === "cancel") {
        setters.setDisconnectConfirmOpen(false);
      }
      if (next.requires2FA) setters.setTwoFaOpen(true);
      if (
        next.status === "ACTIVE" &&
        next.email &&
        pendingKindRef.current === null
      ) {
        setters.setEmail((current) => (current.trim() ? current : next.email!));
      }
    } catch {
      if (!cancelled) {
        setters.setSession({
          status: "DISCONNECTED",
          requires2FA: false,
          email: null,
        });
      }
    } finally {
      if (!cancelled && options?.initial) setters.setStatusLoading(false);
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
}

async function runConnectAccount(ctx: {
  event: React.FormEvent;
  email: string;
  password: string;
  proxy: string;
  connectRequestIdRef: React.MutableRefObject<number>;
  setters: ConnectSessionSetters;
}) {
  ctx.event.preventDefault();
  ctx.setters.setError(null);

  const trimmedEmail = ctx.email.trim();
  if (!trimmedEmail || !ctx.password) {
    ctx.setters.setError("Introduce el email y la contraseña de Wallapop.");
    return;
  }

  const requestId = ++ctx.connectRequestIdRef.current;
  ctx.setters.setPendingKind("connect");
  ctx.setters.setSession({
    status: "AUTHENTICATING",
    requires2FA: false,
    email: trimmedEmail,
  });
  try {
    const next = await connectWallapopAccount({
      email: trimmedEmail,
      password: ctx.password,
      proxy: ctx.proxy,
    });
    if (requestId !== ctx.connectRequestIdRef.current) return;
    ctx.setters.setSession(next);
    if (next.listingsReset) ctx.setters.setListingsResetNotice(true);
    if (next.requires2FA) {
      ctx.setters.setTwoFaOpen(true);
      ctx.setters.setTwoFaCode("");
    }
  } catch (err) {
    if (requestId !== ctx.connectRequestIdRef.current) return;
    ctx.setters.setError(wallapopAccountErrorMessage(err));
    ctx.setters.setSession({
      status: "DISCONNECTED",
      requires2FA: false,
      email: null,
    });
    ctx.setters.setTwoFaOpen(false);
  } finally {
    if (requestId === ctx.connectRequestIdRef.current) {
      ctx.setters.setPendingKind((kind) => (kind === "connect" ? null : kind));
    }
  }
}

async function runSubmitTwoFa(ctx: {
  event: React.FormEvent;
  twoFaCode: string;
  twoFaRequestIdRef: React.MutableRefObject<number>;
  setters: ConnectSessionSetters;
}) {
  ctx.event.preventDefault();
  ctx.setters.setError(null);
  const code = ctx.twoFaCode.trim();
  if (code.length < 4) {
    ctx.setters.setError("Introduce el código 2FA.");
    return;
  }

  const requestId = ++ctx.twoFaRequestIdRef.current;
  ctx.setters.setPendingKind("2fa");
  try {
    const next = await submitWallapop2fa(code);
    if (requestId !== ctx.twoFaRequestIdRef.current) return;
    ctx.setters.setSession(next);
    if (next.listingsReset) ctx.setters.setListingsResetNotice(true);
    if (next.status === "ACTIVE") {
      ctx.setters.setTwoFaOpen(false);
      ctx.setters.setTwoFaCode("");
      ctx.setters.setPassword("");
    } else if (next.requires2FA) {
      ctx.setters.setTwoFaOpen(true);
    }
  } catch (err) {
    if (requestId !== ctx.twoFaRequestIdRef.current) return;
    ctx.setters.setError(wallapopAccountErrorMessage(err));
  } finally {
    if (requestId === ctx.twoFaRequestIdRef.current) {
      ctx.setters.setPendingKind((kind) => (kind === "2fa" ? null : kind));
    }
  }
}

async function runDisconnectAccount(ctx: {
  connectRequestIdRef: React.MutableRefObject<number>;
  twoFaRequestIdRef: React.MutableRefObject<number>;
  setters: ConnectSessionSetters;
}) {
  ctx.setters.setError(null);
  ctx.setters.setDisconnectConfirmOpen(false);
  ctx.connectRequestIdRef.current += 1;
  ctx.twoFaRequestIdRef.current += 1;
  ctx.setters.setPendingKind("disconnect");
  try {
    const next = await disconnectWallapopAccount();
    ctx.setters.setSession(next);
    ctx.setters.setTwoFaOpen(false);
    ctx.setters.setTwoFaCode("");
  } catch (err) {
    ctx.setters.setError(wallapopAccountErrorMessage(err));
  } finally {
    ctx.setters.setPendingKind(null);
  }
}

export type ConnectAccountSession = {
  apiReady: boolean;
  email: string;
  password: string;
  proxy: string;
  showPassword: boolean;
  session: WallapopAccountSession;
  error: string | null;
  pendingKind: PendingKind;
  twoFaOpen: boolean;
  twoFaCode: string;
  statusLoading: boolean;
  disconnectConfirmOpen: boolean;
  resetMode: ResetMode;
  listingsResetNotice: boolean;
  resetBusy: boolean;
  connectedEmail: string | null;
  isActive: boolean;
  isAuthenticating: boolean;
  isDisconnected: boolean;
  showSessionReset: boolean;
  showConnectHint: boolean;
  resetPendingLabel: string;
  resetIdleLabel: string;
  resetConfirmTitle: string;
  resetConfirmDescription: string;
  resetConfirmAction: string;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setProxy: (value: string) => void;
  setShowPassword: React.Dispatch<React.SetStateAction<boolean>>;
  setTwoFaCode: (value: string) => void;
  setTwoFaOpen: (open: boolean) => void;
  setDisconnectConfirmOpen: (open: boolean) => void;
  onConnect: (event: React.FormEvent) => void;
  onSubmit2fa: (event: React.FormEvent) => void;
  onDisconnect: () => void;
  openResetConfirm: (mode: ResetMode) => void;
  requestDisconnect: () => void;
};

function snapshotConnectSession(ctx: {
  apiReady: boolean;
  email: string;
  password: string;
  proxy: string;
  showPassword: boolean;
  session: WallapopAccountSession;
  error: string | null;
  pendingKind: PendingKind;
  twoFaOpen: boolean;
  twoFaCode: string;
  statusLoading: boolean;
  disconnectConfirmOpen: boolean;
  resetMode: ResetMode;
  listingsResetNotice: boolean;
  setters: ConnectSessionSetters;
  setProxy: (value: string) => void;
  setShowPassword: React.Dispatch<React.SetStateAction<boolean>>;
  openResetConfirm: (mode: ResetMode) => void;
}): Omit<ConnectAccountSession, "onConnect" | "onSubmit2fa" | "onDisconnect"> {
  const resetBusy = ctx.pendingKind === "disconnect";
  const isActive = ctx.session.status === "ACTIVE";
  const isAuthenticating = ctx.session.status === "AUTHENTICATING";
  const isDisconnected = ctx.session.status === "DISCONNECTED";
  function requestDisconnect() {
    if (resetBusy) return;
    ctx.openResetConfirm(isActive ? "disconnect" : "cancel");
  }
  return {
    apiReady: ctx.apiReady,
    email: ctx.email,
    password: ctx.password,
    proxy: ctx.proxy,
    showPassword: ctx.showPassword,
    session: ctx.session,
    error: ctx.error,
    pendingKind: ctx.pendingKind,
    twoFaOpen: ctx.twoFaOpen,
    twoFaCode: ctx.twoFaCode,
    statusLoading: ctx.statusLoading,
    disconnectConfirmOpen: ctx.disconnectConfirmOpen,
    resetMode: ctx.resetMode,
    listingsResetNotice: ctx.listingsResetNotice,
    resetBusy,
    connectedEmail: ctx.session.email,
    isActive,
    isAuthenticating,
    isDisconnected,
    showSessionReset: isActive || isAuthenticating,
    showConnectHint: ctx.pendingKind === "connect" && !ctx.twoFaOpen,
    resetPendingLabel:
      ctx.resetMode === "disconnect" ? "Desconectando…" : "Cancelando…",
    resetIdleLabel: isActive ? "Desconectar" : "Cancelar",
    resetConfirmTitle:
      ctx.resetMode === "disconnect"
        ? "¿Desconectar la cuenta?"
        : "¿Cancelar el intento de conexión?",
    resetConfirmDescription:
      ctx.resetMode === "disconnect"
        ? "Se cerrará la sesión de Wallapop en Chrome. Tendrás que volver a iniciar sesión."
        : "Se abortará el login en curso y se cerrará Chrome. Podrás intentarlo de nuevo.",
    resetConfirmAction:
      ctx.resetMode === "disconnect" ? "Desconectar" : "Cancelar intento",
    setEmail: ctx.setters.setEmail,
    setPassword: ctx.setters.setPassword,
    setProxy: ctx.setProxy,
    setShowPassword: ctx.setShowPassword,
    setTwoFaCode: ctx.setters.setTwoFaCode,
    setTwoFaOpen: ctx.setters.setTwoFaOpen,
    setDisconnectConfirmOpen: ctx.setters.setDisconnectConfirmOpen,
    openResetConfirm: ctx.openResetConfirm,
    requestDisconnect,
  };
}

export function useConnectAccountSession(): ConnectAccountSession {
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
  const [statusLoading, setStatusLoading] = useState(apiReady);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [resetMode, setResetMode] = useState<ResetMode>("cancel");
  const [listingsResetNotice, setListingsResetNotice] = useState(false);
  const connectRequestIdRef = useRef(0);
  const twoFaRequestIdRef = useRef(0);
  const pendingKindRef = useRef<PendingKind>(null);
  const resetModeRef = useRef(resetMode);

  const setters: ConnectSessionSetters = {
    setEmail,
    setPassword,
    setSession,
    setError,
    setPendingKind,
    setTwoFaOpen,
    setTwoFaCode,
    setStatusLoading,
    setDisconnectConfirmOpen,
    setListingsResetNotice,
  };

  useEffect(() => {
    pendingKindRef.current = pendingKind;
  }, [pendingKind]);

  useEffect(() => {
    resetModeRef.current = resetMode;
  }, [resetMode]);

  useEffect(() => {
    if (!apiReady) return;
    return attachWallapopStatusSync({
      pendingKindRef,
      resetModeRef,
      setters,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setState fns are stable
  }, [apiReady]);

  function openResetConfirm(mode: ResetMode) {
    if (pendingKind === "disconnect") return;
    setResetMode(mode);
    setTwoFaOpen(false);
    setDisconnectConfirmOpen(true);
  }
  function onConnect(event: React.FormEvent) {
    void runConnectAccount({
      event,
      email,
      password,
      proxy,
      connectRequestIdRef,
      setters,
    });
  }
  function onSubmit2fa(event: React.FormEvent) {
    void runSubmitTwoFa({ event, twoFaCode, twoFaRequestIdRef, setters });
  }
  function onDisconnect() {
    void runDisconnectAccount({
      connectRequestIdRef,
      twoFaRequestIdRef,
      setters,
    });
  }

  const view = snapshotConnectSession({
    apiReady,
    email,
    password,
    proxy,
    showPassword,
    session,
    error,
    pendingKind,
    twoFaOpen,
    twoFaCode,
    statusLoading,
    disconnectConfirmOpen,
    resetMode,
    listingsResetNotice,
    setters,
    setProxy,
    setShowPassword,
    openResetConfirm,
  });
  return { ...view, onConnect, onSubmit2fa, onDisconnect };
}

export function ConnectLoginActions({
  session,
}: {
  session: ConnectAccountSession;
}) {
  const {
    apiReady,
    pendingKind,
    resetBusy,
    isDisconnected,
    showSessionReset,
    isActive,
    resetIdleLabel,
    requestDisconnect,
  } = session;

  return (
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
  );
}

export function ConnectLoginForm({ session }: { session: ConnectAccountSession }) {
  const {
    apiReady,
    email,
    password,
    proxy,
    showPassword,
    pendingKind,
    resetBusy,
    isDisconnected,
    setEmail,
    setPassword,
    setProxy,
    setShowPassword,
    onConnect,
  } = session;
  const fieldsDisabled =
    !apiReady || !isDisconnected || pendingKind === "connect" || resetBusy;

  return (
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
          disabled={fieldsDisabled}
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
            disabled={fieldsDisabled}
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
          <span className="font-normal text-muted-foreground">(opcional)</span>
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
          disabled={fieldsDisabled}
        />
      </div>

      <ConnectLoginActions session={session} />
    </form>
  );
}

export function ConnectResetDialog({
  session,
}: {
  session: ConnectAccountSession;
}) {
  const {
    disconnectConfirmOpen,
    resetBusy,
    resetMode,
    resetConfirmTitle,
    resetConfirmDescription,
    resetPendingLabel,
    resetConfirmAction,
    setDisconnectConfirmOpen,
    onDisconnect,
  } = session;

  return (
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
  );
}

export function ConnectTwoFaDialog({
  session,
}: {
  session: ConnectAccountSession;
}) {
  const {
    twoFaOpen,
    twoFaCode,
    pendingKind,
    resetBusy,
    setTwoFaCode,
    setTwoFaOpen,
    onSubmit2fa,
    openResetConfirm,
  } = session;

  return (
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
  );
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
