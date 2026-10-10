import type { FormEvent } from "react"

export function submitProductForm(
  event: FormEvent<HTMLFormElement>,
  ctx: {
    isSubmittingRef: { current: boolean }
    restoreDraft: boolean
    persistFromForm: (form: HTMLFormElement) => void
    pendingFilesRef: { current: File[] }
    startTransition: (fn: () => void) => void
    formAction: (formData: FormData) => void
  },
) {
  event.preventDefault()
  ctx.isSubmittingRef.current = true
  if (ctx.restoreDraft) {
    ctx.persistFromForm(event.currentTarget)
  }
  const formData = new FormData(event.currentTarget)
  ctx.pendingFilesRef.current.forEach((file) => formData.append("files", file))
  ctx.startTransition(() => {
    ctx.formAction(formData)
  })
}
