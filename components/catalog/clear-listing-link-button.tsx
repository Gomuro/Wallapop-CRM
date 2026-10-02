"use client"

import { useActionState } from "react"
import { useRouter } from "next/navigation"
import { LoaderCircleIcon } from "lucide-react"

import {
  updateProductListingAction,
  type ListingActionState,
} from "@/app/actions/listing"
import { Button } from "@/components/ui/button"
import { actionFailureMessage, isNextRedirect } from "@/lib/api/action-error"

export function ClearListingLinkButton({
  productId,
  variant = "outline",
}: {
  productId: string
  variant?: "default" | "outline" | "secondary"
}) {
  const router = useRouter()
  const bound = updateProductListingAction.bind(null, productId)
  const [state, formAction, pending] = useActionState(
    async (
      prev: ListingActionState,
      formData: FormData,
    ): Promise<ListingActionState> => {
      try {
        const result = await bound(prev, formData)
        if (result.success) router.refresh()
        return result
      } catch (error) {
        if (isNextRedirect(error)) throw error
        return { error: actionFailureMessage(error) }
      }
    },
    {} as ListingActionState,
  )

  return (
    <form action={formAction}>
      <input type="hidden" name="listingStatus" value="READY_TO_POST" />
      <input type="hidden" name="externalUrl" value="" />
      <Button
        type="submit"
        variant={variant}
        className="h-11 w-full"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
        {pending ? "Quitando enlace…" : "Quitar enlace"}
      </Button>
      {state.error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
