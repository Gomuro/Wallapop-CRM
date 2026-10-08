"use client"

import { Field } from "@/components/product-form/product-form-chrome"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ProductActionState } from "@/app/actions/products"
import {
  STANDARD_WEIGHT_BANDS,
  crmKgForStandardBand,
  wallapopStandardWeightBandFromCrm,
} from "@/lib/inventory/wallapop-weight-band"
import type { ShippingPackageSize } from "@/lib/validations"

const CUSTOM_BAND = "custom"

export function ProductFormWeight({
  weightKg,
  setWeightKg,
  shippingPackageSize,
  state,
}: {
  weightKg: string
  setWeightKg: (value: string) => void
  shippingPackageSize: ShippingPackageSize
  state: ProductActionState
}) {
  const parsed = Number(weightKg.replace(",", "."))
  const matchedBand =
    weightKg.trim() === "" || !Number.isFinite(parsed)
      ? null
      : wallapopStandardWeightBandFromCrm(parsed)
  const bandValue = matchedBand ?? CUSTOM_BAND
  const showBands = shippingPackageSize === "STANDARD"

  return (
    <div className="grid gap-2 sm:grid-cols-2 sm:items-start sm:gap-3">
      <Field label="Peso (kg)" htmlFor="weight" error={state.fieldErrors?.weight}>
        <Input
          id="weight"
          name="weight"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={weightKg}
          onChange={(event) => setWeightKg(event.target.value)}
          className="h-11 scroll-mt-28 tabular-nums"
          aria-invalid={Boolean(state.fieldErrors?.weight)}
          aria-describedby={state.fieldErrors?.weight ? "weight-error" : undefined}
        />
      </Field>
      {showBands ? (
        <Field label="Tramo de envío" htmlFor="weightBand">
          <Select
            value={bandValue}
            onValueChange={(value) => {
              if (!value || value === CUSTOM_BAND) return
              const band = STANDARD_WEIGHT_BANDS.find((item) => item.needle === value)
              if (!band) return
              setWeightKg(String(crmKgForStandardBand(band.maxKg)))
            }}
            items={{
              [CUSTOM_BAND]: "Escribir kg",
              ...Object.fromEntries(
                STANDARD_WEIGHT_BANDS.map((item) => [item.needle, item.needle]),
              ),
            }}
          >
            <SelectTrigger
              id="weightBand"
              className="h-11 w-full data-[size=default]:h-11"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CUSTOM_BAND}>Escribir kg</SelectItem>
              {STANDARD_WEIGHT_BANDS.map((item) => (
                <SelectItem key={item.needle} value={item.needle}>
                  {item.needle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
    </div>
  )
}
