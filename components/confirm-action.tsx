"use client"

import type { ReactNode } from "react"
import { LoaderCircleIcon } from "lucide-react"

import { cn } from "cn"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { useIsMd } from "@/lib/ui/media"

type TriggerVariant = "default" | "secondary" | "ghost"

export function ConfirmAction({
  open,
  onOpenChange,
  triggerLabel,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  pendingLabel,
  error,
  pending,
  onConfirm,
  triggerClassName,
  triggerVariant = "default",
  triggerDisabled,
  confirmVariant = "default",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerLabel: string
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  pendingLabel?: string
  error: string | null
  pending?: boolean
  onConfirm: () => void
  triggerClassName: string
  triggerVariant?: TriggerVariant
  triggerDisabled?: boolean
  confirmVariant?: "default" | "destructive"
}) {
  const isMd = useIsMd()
  const trigger = (
    <Button
      className={triggerClassName}
      size="lg"
      variant={triggerVariant}
      disabled={triggerDisabled}
    />
  )
  const confirm = (
    <Button
      variant={confirmVariant}
      className="h-12 w-full md:h-9 md:w-auto"
      disabled={pending}
      aria-busy={pending}
      onClick={onConfirm}
    >
      {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
      {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
    </Button>
  )

  if (isMd) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger disabled={triggerDisabled} render={trigger}>
          {triggerLabel}
        </DialogTrigger>
        <DialogContent
          showCloseButton={false}
          className="max-w-[calc(100%-2rem)] sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <ConfirmError error={error} />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="h-11" />}>
              {cancelLabel}
            </DialogClose>
            {confirm}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerTrigger disabled={triggerDisabled} render={trigger}>
        {triggerLabel}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <ConfirmError error={error} className="px-4" />
        <DrawerFooter>
          {confirm}
          <DrawerClose
            render={<Button variant="ghost" className="h-12 w-full" />}
          >
            {cancelLabel}
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function ConfirmError({
  error,
  className,
}: {
  error: string | null
  className?: string
}): ReactNode {
  if (!error) return null
  return (
    <p className={cn("text-sm text-destructive", className)} role="alert">
      {error}
    </p>
  )
}
