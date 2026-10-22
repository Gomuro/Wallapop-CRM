"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon, LoaderCircleIcon } from "lucide-react"

import { ConfirmAction } from "@/components/confirm-action"

import { AutopostIntervalForm } from "@/components/accounts/autopost-interval-form"
import { ConnectAccountForm } from "@/components/accounts/connect-account-form"
import { DevWatchChrome } from "@/components/accounts/dev-watch-chrome"
import { RestrictionWarning } from "@/components/accounts/restriction-warning"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { PageContainer } from "@/components/shell/page-container"
import { typeScreen } from "@/lib/ui/type"
import { cn } from "@/lib/utils"
import { msToAutopostIntervalInput } from "@/lib/validations/account"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  FIRST_ACCOUNT_CDP_PORT,
  FIRST_ACCOUNT_PROFILE_NAME,
} from "@/lib/accounts/chrome-place"
import {
  createAccountCard,
  deleteAccountCard,
  listAccountCards,
  type ApiAccountCard,
} from "@/lib/api/account-cards"
import { ApiError } from "@/lib/api/errors"
function ChromePlace({ account }: { account: ApiAccountCard }) {
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p>Puerto {account.cdpPort ?? FIRST_ACCOUNT_CDP_PORT}</p>
      <p>Perfil {account.profileName ?? FIRST_ACCOUNT_PROFILE_NAME}</p>
      <p>Catálogo de este login</p>
    </div>
  )
}

function cadence(ms: number | null): string | null {
  if (ms == null || ms <= 0) return null
  const { value, unit } = msToAutopostIntervalInput(ms)
  return `cada ~${value} ${unit === "minutes" ? "min" : unit === "seconds" ? "s" : unit === "hours" ? "h" : "d"}`
}

function autopostLine(account: ApiAccountCard): string {
  const every = cadence(account.autopostIntervalMs)
  const state = account.autopostEnabled ? "En marcha" : "Parado"
  return every ? `Autopost ${state} · ${every}` : `Autopost ${state}`
}

function AccountSummary({ account }: { account: ApiAccountCard }) {
  const login = account.wallapopEmail ?? "Sin login"
  return (
    <Link href={`/accounts/${account.id}`} className="block h-full">
      <Card className="h-full gap-0 transition-colors hover:bg-muted/40">
        <CardHeader>
          <CardTitle className="truncate">{account.name}</CardTitle>
          <CardDescription className="truncate">{login}</CardDescription>
          <CardAction className="flex items-center gap-2">
            {account.isDefault ? <Badge variant="secondary">Principal</Badge> : null}
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </CardAction>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {autopostLine(account)}
          {account.restrictionSuspectedAt ? (
            <span className="block text-destructive">Posible restricción</span>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  )
}

function DeleteAccountButton({
  accountId,
  accountName,
}: {
  accountId: string
  accountName: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function confirm() {
    setError(null)
    setPending(true)
    try {
      await deleteAccountCard(accountId)
      router.push("/accounts")
      router.refresh()
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "No se pudo eliminar la cuenta.",
      )
      setPending(false)
    }
  }

  return (
    <div className="border-t px-4 py-4">
      <ConfirmAction
        open={open}
        onOpenChange={(next) => {
          if (pending) return
          setOpen(next)
          if (!next) setError(null)
        }}
        triggerLabel="Eliminar cuenta"
        triggerClassName="h-12 w-full"
        triggerVariant="destructive"
        title={`Eliminar ${accountName}`}
        description="Se borra esta ficha del CRM. Los productos del almacén se quedan. Los anuncios en Wallapop no se tocan. El Chrome de esta cuenta no pasa a otra ficha. Si era la principal, la cuenta más antigua pasa a ser principal."
        confirmLabel="Eliminar cuenta"
        pendingLabel="Eliminando…"
        confirmVariant="destructive"
        error={error}
        notice={
          <p className="text-sm font-bold uppercase leading-snug text-destructive" role="note">
            Si la eliminas, asegúrate. Esta ficha no se puede recuperar.
          </p>
        }
        pending={pending}
        onConfirm={() => {
          void confirm()
        }}
      />
    </div>
  )
}

function AccountBody({ account }: { account: ApiAccountCard }) {
  return (
    <Card className="w-full gap-0">
      <CardHeader className="border-b">
        <CardTitle>{account.name}</CardTitle>
        <CardDescription>{account.wallapopEmail ?? "Sin login"}</CardDescription>
        {account.isDefault ? (
          <CardAction>
            <Badge variant="secondary">Principal</Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        <RestrictionWarning account={account} />
        <ChromePlace account={account} />
        {process.env.NODE_ENV === "development" ? (
          <DevWatchChrome accountId={account.id} />
        ) : null}
      </CardContent>
      <ConnectAccountForm embedded accountId={account.id} />
      <AutopostIntervalForm embedded accountId={account.id} />
      <DeleteAccountButton accountId={account.id} accountName={account.name} />
    </Card>
  )
}

export function AccountDetail({ accountId }: { accountId: string }) {
  const [account, setAccount] = useState<ApiAccountCard | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void listAccountCards()
      .then((rows) => {
        if (!cancelled) setAccount(rows.find((row) => row.id === accountId) ?? null)
      })
      .catch(() => {
        if (!cancelled) setAccount(null)
      })
    return () => {
      cancelled = true
    }
  }, [accountId])

  const title = account?.name ?? "Cuenta"

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-1 border-b bg-background px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:top-14 md:px-8">
        <Link
          href="/accounts"
          aria-label="Volver a cuentas"
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-11")}
        >
          <ChevronLeftIcon />
        </Link>
        <h1 className={cn(typeScreen, "min-w-0 flex-1 truncate")}>{title}</h1>
      </header>
      <PageContainer className="py-4 md:py-8">
        <div className="mx-auto w-full max-w-md">
          {account === undefined ? (
            <p className="text-sm text-muted-foreground">Cargando cuenta…</p>
          ) : null}
          {account === null ? (
            <p className="text-sm text-muted-foreground">No está esta cuenta.</p>
          ) : null}
          {account ? <AccountBody account={account} /> : null}
        </div>
      </PageContainer>
    </>
  )
}

function AddAccountForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError("Escribe un nombre.")
      return
    }
    setPending(true)
    setError(null)
    try {
      await createAccountCard(trimmed)
      setName("")
      setOpen(false)
      onCreated()
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "No se pudo crear la cuenta.",
      )
    } finally {
      setPending(false)
    }
  }

  if (!open) {
    return (
      <Button type="button" className="h-12 w-full" onClick={() => setOpen(true)}>
        Añadir cuenta
      </Button>
    )
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-account-name">Nombre</Label>
        <Input
          id="new-account-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-12"
          maxLength={100}
          autoComplete="off"
          placeholder="Nombre de la cuenta"
        />
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="h-12 w-full" disabled={pending}>
        {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
        Crear cuenta
      </Button>
    </form>
  )
}

function SingleAccountFallback() {
  return (
    <>
      <ConnectAccountForm />
      <AutopostIntervalForm />
    </>
  )
}

export function AccountList() {
  const [accounts, setAccounts] = useState<ApiAccountCard[] | null>(null)
  const [failed, setFailed] = useState(false)

  const reload = useCallback(() => {
    void listAccountCards()
      .then((rows) => {
        setAccounts(rows)
        setFailed(false)
      })
      .catch(() => {
        setFailed(true)
      })
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  if (accounts === null) {
    if (failed) return <SingleAccountFallback />
    return <p className="text-sm text-muted-foreground">Cargando cuentas…</p>
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {accounts.map((account) => (
          <AccountSummary key={account.id} account={account} />
        ))}
      </div>
      <AddAccountForm onCreated={reload} />
    </>
  )
}
