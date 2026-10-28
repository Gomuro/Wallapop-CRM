"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { actionFailureMessage, isNextRedirect } from "@/lib/api/action-error"
import { apiClientFetch } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import { formatEuro } from "@/lib/inventory/format"
import type { DuplicateVariant } from "@/lib/inventory/types"

const TITLE_MAX = 50
/** Generation retries the model up to three times; the default 25 s is too short. */
const GENERATE_TIMEOUT_MS = 90_000

type Original = { title: string; description: string; price: number }

function errorText(caught: unknown) {
  return caught instanceof ApiError ? caught.message : actionFailureMessage(caught)
}

function useVariantRequest(productId: string, accountId: string) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  function run(path: string, method: "POST" | "PUT", extra: object, onDone?: () => void) {
    setError(null)
    startTransition(async () => {
      try {
        await apiClientFetch(`/products/${encodeURIComponent(productId)}/${path}`, {
          method,
          body: JSON.stringify({ accountId, ...extra }),
          timeoutMs: GENERATE_TIMEOUT_MS,
        })
        onDone?.()
        router.refresh()
      } catch (caught) {
        if (isNextRedirect(caught)) throw caught
        setError(errorText(caught))
      }
    })
  }
  return { pending, error, run }
}

function SideBySide({ label, original, duplicate }: { label: string; original: string; duplicate: string }) {
  return (
    <div className="grid gap-2 py-2.5 sm:grid-cols-2 sm:gap-4">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label} · original</p>
        <p className="whitespace-pre-line break-words text-sm text-muted-foreground">{original}</p>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label} · duplicado</p>
        <p className="whitespace-pre-line break-words text-sm font-medium">{duplicate}</p>
      </div>
    </div>
  )
}

function VariantBadges({ variant }: { variant: DuplicateVariant }) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-2.5">
      {variant.source ? (
        <Badge variant="outline">{variant.source === "manual" ? "Texto manual" : "Texto IA"}</Badge>
      ) : null}
      {variant.stale ? <Badge variant="secondary">El producto cambió después</Badge> : null}
    </div>
  )
}

function EditForm({
  variant,
  pending,
  onSave,
  onCancel,
}: {
  variant: DuplicateVariant | null
  pending: boolean
  onSave: (title: string, description: string) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(variant?.title ?? "")
  const [description, setDescription] = useState(variant?.description ?? "")
  const tooLong = title.trim().length > TITLE_MAX
  return (
    <div className="space-y-3 py-3">
      <div className="space-y-1.5">
        <Label htmlFor="variant-title">Título del duplicado</Label>
        <Input id="variant-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        <p className={tooLong ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {title.trim().length}/{TITLE_MAX}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="variant-description">Descripción del duplicado</Label>
        <Textarea
          id="variant-description"
          rows={8}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button
          disabled={pending || tooLong || !title.trim() || !description.trim()}
          onClick={() => onSave(title, description)}
        >
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

function VariantView({ original, variant }: { original: Original; variant: DuplicateVariant }) {
  return (
    <div className="divide-y divide-border">
      <SideBySide label="Título" original={original.title} duplicate={variant.title ?? ""} />
      <SideBySide
        label="Precio"
        original={formatEuro(original.price)}
        duplicate={variant.price == null ? "" : formatEuro(variant.price)}
      />
      <SideBySide label="Descripción" original={original.description} duplicate={variant.description ?? ""} />
    </div>
  )
}

/** Background writes after this many failed runs deserve a look, though they keep going. */
const ATTEMPTS_WORTH_A_LOOK = 5

function nextTryLabel(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(date)
}

/** PREPARING: the text is being written in the background. A waiting state, not an error. */
function PreparingNotice({ variant }: { variant: DuplicateVariant | null }) {
  const attempts = variant?.attempts ?? 0
  const next = nextTryLabel(variant?.nextAttemptAt ?? null)
  const worthALook = attempts >= ATTEMPTS_WORTH_A_LOOK
  return (
    <div className="space-y-1 py-2.5" role="status">
      <p className="text-sm font-medium">Preparando el texto del duplicado</p>
      <p className="text-xs text-muted-foreground">
        {attempts === 0
          ? "Se publicará en cuanto el texto esté listo."
          : `Lleva ${attempts} ${attempts === 1 ? "intento" : "intentos"}${next ? `; el siguiente, a las ${next}` : ""}.`}
      </p>
      {worthALook ? (
        <Badge variant="secondary">Conviene revisarlo: lleva {attempts} intentos</Badge>
      ) : null}
      {variant?.error ? (
        <p className="text-xs text-muted-foreground">Último intento: {variant.error}</p>
      ) : null}
    </div>
  )
}

/**
 * Duplicate ad on a non-default account: own wording and ,98 price next to the original.
 * Locked while the duplicate is live or posting, so the CRM text matches Wallapop.
 */
export function DuplicateVariantPanel({
  productId,
  accountId,
  original,
  variant,
  locked,
  preparing,
}: {
  productId: string
  accountId: string
  original: Original
  variant: DuplicateVariant | null
  locked: boolean
  preparing: boolean
}) {
  const request = useVariantRequest(productId, accountId)
  const [editing, setEditing] = useState(false)
  // While PREPARING the last error is shown calmly inside the notice, not in red.
  const failure = request.error ?? (preparing ? null : variant?.error) ?? null
  return (
    <div className="rounded-lg bg-muted/30 px-3 pb-3">
      {preparing && !editing ? <PreparingNotice variant={variant} /> : null}
      {variant?.title ? <VariantBadges variant={variant} /> : null}
      {editing ? (
        <EditForm
          variant={variant}
          pending={request.pending}
          onCancel={() => setEditing(false)}
          onSave={(title, description) =>
            request.run("variant", "PUT", { title, description }, () => setEditing(false))
          }
        />
      ) : variant?.title ? (
        <VariantView original={original} variant={variant} />
      ) : preparing ? null : (
        <p className="py-2.5 text-sm text-muted-foreground">Todavía no hay texto propio para este duplicado.</p>
      )}
      {failure ? <p className="pb-2 text-sm text-destructive">{failure}</p> : null}
      {locked ? (
        <p className="text-xs text-muted-foreground">No se puede cambiar mientras el anuncio está en Wallapop.</p>
      ) : editing ? null : (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="secondary" disabled={request.pending} onClick={() => request.run("variant/regenerate", "POST", {})}>
            {request.pending ? "Generando…" : "Regenerar con IA"}
          </Button>
          <Button variant="ghost" disabled={request.pending} onClick={() => setEditing(true)}>
            Editar a mano
          </Button>
        </div>
      )}
    </div>
  )
}
