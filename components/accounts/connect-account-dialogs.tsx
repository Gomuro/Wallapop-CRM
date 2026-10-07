"use client";

import { LoaderCircleIcon } from "lucide-react";

import type { ConnectAccountSession } from "@/components/accounts/connect-account-session";
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
