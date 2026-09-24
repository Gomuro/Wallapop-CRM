"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import {
  deleteProductAction,
  markProductSoldAction,
} from "@/app/actions/products"
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

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (isSold) {
          setOpen(false)
          return
        }
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <DrawerTrigger
        disabled={isSold}
        render={<Button className="h-12 w-full bg-primary" size="lg" />}
      >
        {isSold ? "Sold" : "Mark as SOLD"}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Mark as SOLD</DrawerTitle>
          <DrawerDescription>
            This sets the product to SOLD and deactivates every linked listing
            (where it hangs).
          </DrawerDescription>
        </DrawerHeader>
        {error ? (
          <p className="px-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DrawerFooter>
          <Button
            className="h-12 w-full bg-primary"
            size="lg"
            disabled={pending}
            onClick={() => {
              setError(null)
              startTransition(async () => {
                try {
                  await markProductSoldAction(productId)
                  setSold(true)
                  setOpen(false)
                  router.refresh()
                } catch (caught) {
                  setError(
                    caught instanceof Error
                      ? caught.message
                      : "Could not mark as sold.",
                  )
                }
              })
            }}
          >
            {pending ? "Syncing…" : "Confirm sold"}
          </Button>
          <DrawerClose render={<Button variant="ghost" className="h-11 w-full" />}>
            Cancel
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export function DeleteProductButton({ productId }: { productId: string }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" className="h-11 w-full text-destructive" />}
      >
        Delete item
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete product</DialogTitle>
          <DialogDescription>
            This removes the item from the mock catalog. It cannot be undone in
            this session.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => {
              setError(null)
              startTransition(async () => {
                try {
                  await deleteProductAction(productId)
                } catch (caught) {
                  if (
                    typeof caught === "object" &&
                    caught !== null &&
                    "digest" in caught &&
                    String(caught.digest).startsWith("NEXT_REDIRECT")
                  ) {
                    throw caught
                  }
                  setError(
                    caught instanceof Error
                      ? caught.message
                      : "Could not delete item.",
                  )
                }
              })
            }}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
