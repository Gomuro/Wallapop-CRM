"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition, type ReactNode } from "react"
import { LoaderCircleIcon } from "lucide-react"

import {
  deleteProductAction,
  markProductSoldAction,
} from "@/app/actions/products"
import { actionFailureMessage, isNextRedirect } from "@/lib/api/action-error"
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

function ConfirmFrame({
  open,
  onOpenChange,
  label,
  triggerClassName,
  triggerVariant = "default",
  triggerDisabled,
  title,
  description,
  error,
  confirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  triggerClassName: string
  triggerVariant?: "default" | "secondary" | "ghost"
  triggerDisabled?: boolean
  title: string
  description: string
  error: string | null
  confirm: ReactNode
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

  if (isMd) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger disabled={triggerDisabled} render={trigger}>
          {label}
        </DialogTrigger>
        <DialogContent showCloseButton={false} className="max-w-[calc(100%-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="h-11" />}>
              Cancelar
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
        {label}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        {error ? (
          <p className="px-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DrawerFooter>
          {confirm}
          <DrawerClose render={<Button variant="ghost" className="h-12 w-full" />}>
            Cancelar
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export function SoldSyncButton({
  productId,
  disabled,
}: {
  productId: string
  disabled?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [sold, setSold] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const isSold = disabled || sold

  function handleOpenChange(next: boolean) {
    if (isSold) {
      setOpen(false)
      return
    }
    setOpen(next)
    if (!next) setError(null)
  }

  function confirmSold() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await markProductSoldAction(productId)
        if (result.error) {
          setError(result.error)
          return
        }
        setSold(true)
        setOpen(false)
        router.refresh()
      } catch (caught) {
        if (isNextRedirect(caught)) throw caught
        setError(actionFailureMessage(caught))
      }
    })
  }

  return (
    <ConfirmFrame
      open={open}
      onOpenChange={handleOpenChange}
      label={isSold ? "Vendido" : "Marcar como vendido"}
      triggerClassName="h-12 w-full"
      triggerVariant={isSold ? "secondary" : "default"}
      triggerDisabled={isSold}
      title="Marcar como vendido"
      description="El producto pasará a Vendido y se desactivarán todos los anuncios vinculados."
      error={error}
      confirm={
        <Button
          className="h-12 w-full md:h-9 md:w-auto"
          disabled={pending}
          aria-busy={pending}
          onClick={confirmSold}
        >
          {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
          {pending ? "Sincronizando…" : "Confirmar"}
        </Button>
      }
    />
  )
}

export function DeleteProductButton({ productId }: { productId: string }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <ConfirmFrame
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setError(null)
      }}
      label="Eliminar"
      triggerClassName="h-12 w-full text-destructive"
      triggerVariant="ghost"
      title="Eliminar producto"
      description="Se quitará del catálogo. Esta acción no se puede deshacer en esta sesión."
      error={error}
      confirm={
        <Button
          variant="destructive"
          className="h-12 w-full md:h-9 md:w-auto"
          disabled={pending}
          aria-busy={pending}
          onClick={() => {
            setError(null)
            startTransition(async () => {
              try {
                const result = await deleteProductAction(productId)
                if (result?.error) setError(result.error)
              } catch (caught) {
                if (isNextRedirect(caught)) throw caught
                setError(actionFailureMessage(caught))
              }
            })
          }}
        >
          {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
          {pending ? "Eliminando…" : "Eliminar"}
        </Button>
      }
    />
  )
}
