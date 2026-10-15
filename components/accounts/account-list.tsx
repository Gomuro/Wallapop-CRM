"use client"

import { useCallback, useEffect, useState } from "react"
import { LoaderCircleIcon } from "lucide-react"

import { AutopostIntervalForm } from "@/components/accounts/autopost-interval-form"
import { ConnectAccountForm } from "@/components/accounts/connect-account-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  listAccountCards,
  type ApiAccountCard,
} from "@/lib/api/account-cards"
import { ApiError } from "@/lib/api/errors"
import { msToAutopostIntervalInput } from "@/lib/validations/account"

function ChromePlace({ isDefault }: { isDefault: boolean }) {
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p>Puerto {isDefault ? FIRST_ACCOUNT_CDP_PORT : "—"}</p>
      <p>Perfil {isDefault ? FIRST_ACCOUNT_PROFILE_NAME : "—"}</p>
      <p>Catálogo de este login</p>
    </div>
  )
}

function cadence(ms: number | null): string | null {
  if (ms == null || ms <= 0) return null
  const { value, unit } = msToAutopostIntervalInput(ms)
  return `cada ~${value} ${unit === "minutes" ? "min" : unit === "seconds" ? "s" : unit === "hours" ? "h" : "d"}`
}

function QuietAccountBody({ account }: { account: ApiAccountCard }) {
  const every = cadence(account.autopostIntervalMs)
  return (
    <CardContent className="flex flex-col gap-4">
      <ChromePlace isDefault={false} />
      <div className="border-t pt-4">
        <p className="text-sm font-medium">Login</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {account.wallapopEmail ?? "Sin login"}
        </p>
      </div>
      <div className="border-t pt-4">
        <p className="text-sm font-medium">Autopost</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {account.autopostEnabled ? "En marcha" : "Parado"}
          {every ? ` · ${every}` : ""}
        </p>
      </div>
      <div className="rounded-lg bg-muted/40 px-3 py-2.5">
        <p className="text-sm font-medium">Ahora</p>
        <p className="mt-0.5 text-sm text-muted-foreground">Sin tarea</p>
      </div>
    </CardContent>
  )
}

function AccountCard({ account }: { account: ApiAccountCard }) {
  const login = account.wallapopEmail ?? "Sin login"
  return (
    <Card className="w-full gap-0">
      <CardHeader className="border-b">
        <CardTitle>{account.name}</CardTitle>
        <CardDescription>{login}</CardDescription>
        {account.isDefault ? (
          <CardAction>
            <Badge variant="secondary">Principal</Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      {account.isDefault ? (
        <>
          <CardContent>
            <ChromePlace isDefault />
          </CardContent>
          <ConnectAccountForm embedded />
          <AutopostIntervalForm embedded />
        </>
      ) : (
        <QuietAccountBody account={account} />
      )}
    </Card>
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
      {accounts.map((account) => (
        <AccountCard key={account.id} account={account} />
      ))}
      <AddAccountForm onCreated={reload} />
    </>
  )
}
