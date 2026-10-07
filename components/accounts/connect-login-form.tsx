"use client";

import { EyeIcon, EyeOffIcon, Link2Icon, LoaderCircleIcon } from "lucide-react";

import type { ConnectAccountSession } from "@/components/accounts/connect-account-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
