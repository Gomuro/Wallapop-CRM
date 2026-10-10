"use client";

import { useEffect, useRef, useState } from "react";

import { isApiConfigured } from "@/lib/api/config";
import {
  connectWallapopAccount,
  disconnectWallapopAccount,
  getWallapopAccountStatus,
  submitWallapop2fa,
  wallapopAccountErrorMessage,
  type WallapopAccountSession,
} from "@/lib/api/wallapop-account";

import type {
  ConnectAccountSession,
  PendingKind,
  ResetMode,
} from "@/components/accounts/connect-account-session-types"

export type { ConnectAccountSession } from "@/components/accounts/connect-account-session-types"

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
