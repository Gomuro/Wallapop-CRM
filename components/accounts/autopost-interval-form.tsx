"use client"

import { Card } from "@/components/ui/card"

import {
  AutopostIntervalFields,
  AutopostStartConfirmDialog,
} from "./autopost-interval-controls"
import { useAutopostIntervalState } from "./autopost-interval-state"
import { AutopostStatusCard } from "./autopost-status-card"

export function AutopostIntervalForm({ embedded = false }: { embedded?: boolean }) {
  const state = useAutopostIntervalState()
  const interval = (
    <div className="border-t px-4 pt-4 pb-4">
      <p className="mb-3 text-sm font-medium">Intervalo</p>
      <AutopostIntervalFields state={state} />
    </div>
  )
  if (embedded) {
    return (
      <>
        <AutopostStatusCard state={state} />
        {interval}
        <AutopostStartConfirmDialog state={state} />
      </>
    )
  }
  return (
    <Card className="mx-auto w-full max-w-md gap-0">
      <AutopostStatusCard state={state} />
      {interval}
      <AutopostStartConfirmDialog state={state} />
    </Card>
  )
}
