"use client"

import { useState, type FormEvent } from "react"
import { LoaderCircleIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { updateAccountPriceEnding } from "@/lib/api/account-cards"
import { ApiError } from "@/lib/api/errors"
import { DEFAULT_PRICE_ENDING, duplicatePrice } from "@/lib/inventory/duplicate-price"
import { formatEuro } from "@/lib/inventory/format"
import { PRICE_ENDING_MAX, PRICE_ENDING_MIN } from "@/lib/validations/account"

/** Originals the live example is shown for: an ordinary ,95 price and a round one. */
const EXAMPLE_PRICES = [59.95, 120]

function parseEnding(raw: string): number | null {
  if (!/^\d{1,2}$/.test(raw.trim())) return null
  const value = Number(raw)
  return value >= PRICE_ENDING_MIN && value <= PRICE_ENDING_MAX ? value : null
}

function savedNotice(repriced: number): string {
  if (repriced === 0) return "Guardado. No había duplicados en cola que cambiar."
  return repriced === 1
    ? "Guardado. 1 duplicado en cola tiene ya el nuevo precio."
    : `Guardado. ${repriced} duplicados en cola tienen ya el nuevo precio.`
}

function EndingExample({ ending }: { ending: number | null }) {
  if (ending == null) {
    return <p className="text-sm text-destructive">Introduce un número de 0 a 99.</p>
  }
  return (
    <ul className="space-y-1 text-sm text-muted-foreground">
      {EXAMPLE_PRICES.map((price) => (
        <li key={price}>
          {formatEuro(price)} → <span className="font-medium text-foreground">{formatEuro(duplicatePrice(price, ending))}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Cents a duplicate price ends in on a non-default account. The default account
 * publishes the original price, so it never shows this field.
 */
export function PriceEndingForm({
  accountId,
  initialEnding,
}: {
  accountId: string
  initialEnding: number | undefined
}) {
  const [raw, setRaw] = useState(String(initialEnding ?? DEFAULT_PRICE_ENDING))
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ending = parseEnding(raw)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (ending == null) return
    setSaving(true)
    setNotice(null)
    setError(null)
    try {
      const result = await updateAccountPriceEnding(accountId, ending)
      setNotice(savedNotice(result.repriced))
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo guardar la terminación.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} className="flex flex-col gap-3 border-t px-4 pt-4 pb-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="price-ending">Terminación del precio</Label>
        <p className="text-sm text-muted-foreground">
          Céntimos en los que acaba el precio de los duplicados de esta cuenta. Nunca más de 3 céntimos
          por encima del original. Cambia también los duplicados en cola; los ya publicados se quedan igual.
        </p>
        <Input
          id="price-ending"
          name="priceEnding"
          type="number"
          inputMode="numeric"
          min={PRICE_ENDING_MIN}
          max={PRICE_ENDING_MAX}
          step={1}
          className="h-12 w-28 text-base md:h-10 md:text-sm"
          value={raw}
          onChange={(event) => {
            setRaw(event.target.value)
            setNotice(null)
            setError(null)
          }}
          disabled={saving}
          required
        />
      </div>
      <EndingExample ending={ending} />
      {notice ? <p className="text-sm text-muted-foreground" role="status">{notice}</p> : null}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <Button
        type="submit"
        variant="outline"
        className="h-12 w-full"
        disabled={saving || ending == null}
        aria-busy={saving || undefined}
      >
        {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
        {saving ? "Guardando…" : "Guardar terminación"}
      </Button>
    </form>
  )
}
