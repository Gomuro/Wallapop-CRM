"use client"

import {
  AutopostIntervalFields,
  AutopostStartConfirmDialog,
} from "./autopost-interval-controls"
import { useAutopostIntervalState } from "./autopost-interval-state"
import { AutopostStatusCard } from "./autopost-status-card"

export function AutopostIntervalForm() {
  const state = useAutopostIntervalState()
  return (
    <div className="mx-auto w-full max-w-md border-t border-border pt-8">
      <AutopostStatusCard state={state} />
      <AutopostIntervalFields state={state} />
      <AutopostStartConfirmDialog state={state} />
    </div>
  )
}
