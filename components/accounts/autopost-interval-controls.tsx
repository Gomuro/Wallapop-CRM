"use client"

import { LoaderCircleIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  AUTOPOST_INTERVAL_UNITS,
  type AutopostIntervalUnit,
} from "@/lib/validations/account"

import {
  saveAutopostInterval,
  startAutopostRun,
  type AutopostIntervalState,
} from "./autopost-interval-state"

const UNIT_LABEL: Record<AutopostIntervalUnit, string> = {
  seconds: "Segundos",
  minutes: "Minutos",
  hours: "Horas",
  days: "Días",
}

export function AutopostIntervalFields({
  state,
}: {
  state: AutopostIntervalState
}) {
  const { apiReady, value, unit, busy, saving, setters, setValue, setUnit } =
    state

  return (
    <form
      onSubmit={(event) => void saveAutopostInterval({ event, value, unit, setters })}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-[1fr_8.5rem] gap-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="autopost-interval-value">Cantidad</Label>
          <Input
            id="autopost-interval-value"
            name="value"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            className="h-12 text-base md:h-10 md:text-sm"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!apiReady || busy}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="autopost-interval-unit">Unidad</Label>
          <select
            id="autopost-interval-unit"
            name="unit"
            className="h-12 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:text-sm"
            value={unit}
            onChange={(event) =>
              setUnit(event.target.value as AutopostIntervalUnit)
            }
            disabled={!apiReady || busy}
          >
            {AUTOPOST_INTERVAL_UNITS.map((item) => (
              <option key={item} value={item}>
                {UNIT_LABEL[item]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Button
        type="submit"
        variant="outline"
        className="h-12 w-full"
        disabled={!apiReady || busy}
        aria-busy={saving || undefined}
      >
        {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
        {saving ? "Guardando…" : "Guardar intervalo"}
      </Button>
    </form>
  )
}

export function AutopostStartConfirmDialog({
  state,
}: {
  state: AutopostIntervalState
}) {
  const { startConfirmOpen, toggling, setters } = state
  return (
    <Dialog open={startConfirmOpen} onOpenChange={setters.setStartConfirmOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Iniciar el autopost?</DialogTitle>
          <DialogDescription>
            Solo se publicarán anuncios en «Listo para publicar» de esta
            cuenta de Wallapop. No hay supervisión de qué hay o no hay ya en
            el marketplace. Si un artículo ya está en Wallapop pero el CRM no
            lo sabe, se puede duplicar.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full sm:w-auto"
            onClick={() => setters.setStartConfirmOpen(false)}
          >
            Volver
          </Button>
          <Button
            type="button"
            className="h-11 w-full sm:w-auto"
            disabled={toggling}
            onClick={() => void startAutopostRun(setters)}
          >
            {toggling ? <LoaderCircleIcon className="animate-spin" /> : null}
            Iniciar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
