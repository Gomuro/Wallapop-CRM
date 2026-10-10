import type { Dispatch, FormEvent, SetStateAction } from "react"

import type { WallapopAccountSession } from "@/lib/api/wallapop-account"

export type PendingKind = "connect" | "2fa" | "disconnect" | null
export type ResetMode = "disconnect" | "cancel"

export type ConnectAccountFormFields = {
  email: string
  password: string
  proxy: string
  showPassword: boolean
  twoFaCode: string
  twoFaOpen: boolean
  disconnectConfirmOpen: boolean
}

export type ConnectAccountStatusFlags = {
  apiReady: boolean
  session: WallapopAccountSession
  error: string | null
  pendingKind: PendingKind
  statusLoading: boolean
  resetBusy: boolean
  isActive: boolean
  isAuthenticating: boolean
  isDisconnected: boolean
}

export type ConnectAccountResetCopy = {
  resetMode: ResetMode
  listingsResetNotice: boolean
  showSessionReset: boolean
  showConnectHint: boolean
  connectedEmail: string | null
  resetPendingLabel: string
  resetIdleLabel: string
  resetConfirmTitle: string
  resetConfirmDescription: string
  resetConfirmAction: string
}

export type ConnectAccountSettersSlice = {
  setEmail: (value: string) => void
  setPassword: (value: string) => void
  setProxy: (value: string) => void
  setShowPassword: Dispatch<SetStateAction<boolean>>
  setTwoFaCode: (value: string) => void
  setTwoFaOpen: (open: boolean) => void
  setDisconnectConfirmOpen: (open: boolean) => void
}

export type ConnectAccountActions = {
  onConnect: (event: FormEvent) => void
  onSubmit2fa: (event: FormEvent) => void
  onDisconnect: () => void
  openResetConfirm: (mode: ResetMode) => void
  requestDisconnect: () => void
}

export type ConnectAccountSession = ConnectAccountFormFields &
  ConnectAccountStatusFlags &
  ConnectAccountResetCopy &
  ConnectAccountSettersSlice &
  ConnectAccountActions
