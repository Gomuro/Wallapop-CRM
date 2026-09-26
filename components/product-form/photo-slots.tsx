"use client"

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { LoaderCircleIcon, PlusIcon, XIcon } from "lucide-react"

import {
  deleteProductImageAction,
  reorderProductImagesAction,
  uploadProductImages,
} from "@/app/actions/uploads"
import { Badge } from "@/components/ui/badge"
import type { InventoryProductImage } from "@/lib/inventory/types"
import { PRODUCT_IMAGE_MAX } from "@/lib/validations/product"
import { loadDraftPhotos } from "@/lib/product-form/draft"
import { compressImageFiles } from "@/lib/images/compress"
import { actionFailureMessage, isNextRedirect } from "@/lib/api/action-error"
import { typeMeta } from "@/lib/ui/type"
import { cn } from "@/lib/utils"

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"]
const DRAG_THRESHOLD_PX = 8
const PRESS_DELAY_MS = 150

type SlotImage = {
  url: string
  id?: string
  file?: File
}

function reorderSlots(images: SlotImage[], from: number, to: number): SlotImage[] {
  if (from === to || from < 0 || to < 0 || from >= images.length) return images
  const next = [...images]
  const [moved] = next.splice(from, 1)
  if (!moved) return images
  next.splice(Math.min(to, next.length), 0, moved)
  return next
}

type DragSession = {
  pointerId: number
  from: number
  startX: number
  startY: number
  ready: boolean
  active: boolean
  timer: number
}

export function PhotoSlots({
  productId,
  productImages = [],
  restoreDraft = false,
  onPendingFilesChange,
}: {
  productId?: string
  productImages?: InventoryProductImage[]
  restoreDraft?: boolean
  onPendingFilesChange?: (files: File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<DragSession | null>(null)
  const overIndexRef = useRef<number | null>(null)
  const replaceIndexRef = useRef<number | undefined>(undefined)
  const [slots, setSlots] = useState<SlotImage[]>(() =>
    productImages
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((image) => ({ url: image.url, id: image.id })),
  )
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (productId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync slot state when server updates product images
      setSlots(
        productImages
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((image) => ({ url: image.url, id: image.id })),
      )
    }
  }, [productId, productImages])

  useEffect(() => {
    if (productId || !restoreDraft) return
    let cancelled = false
    void loadDraftPhotos().then(async (files) => {
      if (cancelled || files.length === 0) return
      const compressed = await compressImageFiles(
        files.slice(0, PRODUCT_IMAGE_MAX),
      )
      if (cancelled) return
      setSlots(
        compressed.map((file) => ({
          url: URL.createObjectURL(file),
          file,
        })),
      )
    })
    return () => {
      cancelled = true
    }
  }, [productId, restoreDraft])

  const onPendingFilesChangeRef = useRef(onPendingFilesChange)
  useEffect(() => {
    onPendingFilesChangeRef.current = onPendingFilesChange
  })

  useEffect(() => {
    if (productId) return
    onPendingFilesChangeRef.current?.(
      slots.map((slot) => slot.file).filter(Boolean) as File[],
    )
  }, [slots, productId])

  function clearAll() {
    slots.forEach((s) => {
      if (s.url.startsWith("blob:")) URL.revokeObjectURL(s.url)
    })
    setSlots([])
    setError(null)
  }

  const safeImages = slots
  const gridSlots = Array.from(
    { length: PRODUCT_IMAGE_MAX },
    (_, index) => safeImages[index] ?? null,
  )

  function commit(next: SlotImage[]) {
    setSlots(next.slice(0, PRODUCT_IMAGE_MAX))
  }

  function roomFor(atIndex?: number) {
    const replacing =
      typeof atIndex === "number" && atIndex >= 0 && atIndex < safeImages.length
    return replacing
      ? PRODUCT_IMAGE_MAX - safeImages.length + 1
      : PRODUCT_IMAGE_MAX - safeImages.length
  }

  async function persistOrder(next: SlotImage[]) {
    if (!productId) return
    const ids = next.map((slot) => slot.id).filter(Boolean) as string[]
    if (ids.length !== next.length) return
    try {
      const result = await reorderProductImagesAction(productId, ids)
      if (result.error) setError(result.error)
    } catch (error) {
      if (isNextRedirect(error)) throw error
      setError(actionFailureMessage(error))
    }
  }

  async function addFiles(fileList: FileList | null, atIndex?: number) {
    if (!fileList?.length || uploading) return
    const incoming = Array.from(fileList)
    const valid = incoming.filter(
      (file) =>
        ACCEPTED_TYPES.includes(file.type) ||
        /\.(jpe?g|png|webp)$/i.test(file.name),
    )
    const rejectedType = incoming.length - valid.length
    if (valid.length === 0) {
      setError("Usa JPEG, PNG o WebP.")
      return
    }

    const room = roomFor(atIndex)
    if (room <= 0) {
      setError(`Máximo ${PRODUCT_IMAGE_MAX} fotos.`)
      return
    }

    const accepted = valid.slice(0, room)
    const skipped = valid.length - accepted.length

    setUploading(true)
    setError(null)
    let compressed: File[]
    try {
      compressed = await compressImageFiles(accepted)
    } catch {
      setUploading(false)
      setError("No se pudieron procesar las fotos. Prueba con otra imagen.")
      return
    }

    if (productId) {
      const formData = new FormData()
      compressed.forEach((file) => formData.append("files", file))
      try {
        const result = await uploadProductImages(formData, productId)
        if (result.error || result.urls.length === 0) {
          setError(result.error ?? "No se pudo guardar la imagen.")
          return
        }
        const uploaded = result.urls.map((url, index) => ({
          url,
          id: result.imageIds?.[index],
        }))
        const next = [...safeImages]
        if (typeof atIndex === "number" && atIndex >= 0 && atIndex < next.length) {
          next.splice(atIndex, 1, ...uploaded)
        } else {
          next.push(...uploaded)
        }
        commit(next.slice(0, PRODUCT_IMAGE_MAX))
      } catch (error) {
        if (isNextRedirect(error)) throw error
        setError(actionFailureMessage(error))
        return
      } finally {
        setUploading(false)
      }
    } else {
      const added: SlotImage[] = compressed.map((file) => ({
        url: URL.createObjectURL(file),
        file,
      }))
      const next = [...safeImages]
      if (typeof atIndex === "number" && atIndex >= 0 && atIndex < next.length) {
        const old = next[atIndex]
        if (old?.url.startsWith("blob:")) URL.revokeObjectURL(old.url)
        next.splice(atIndex, 1, ...added)
      } else {
        next.push(...added)
      }
      commit(next.slice(0, PRODUCT_IMAGE_MAX))
      setUploading(false)
    }

    const notes: string[] = []
    if (skipped > 0) {
      notes.push(
        `Máximo ${PRODUCT_IMAGE_MAX} fotos. No se añadieron los archivos extra.`,
      )
    }
    if (rejectedType > 0) {
      notes.push("Algunos archivos se omitieron. Usa JPEG, PNG o WebP.")
    }
    if (notes.length > 0) setError(notes.join(" "))
  }

  async function remove(index: number) {
    const target = safeImages[index]
    if (!target) return
    if (productId && target.id) {
      setUploading(true)
      try {
        const result = await deleteProductImageAction(productId, target.id)
        if (result.error) {
          setError(result.error)
          return
        }
      } catch (error) {
        if (isNextRedirect(error)) throw error
        setError(actionFailureMessage(error))
        return
      } finally {
        setUploading(false)
      }
    }
    if (target.url.startsWith("blob:")) URL.revokeObjectURL(target.url)
    const next = safeImages.filter((_, itemIndex) => itemIndex !== index)
    commit(next)
    if (productId) await persistOrder(next)
  }

  function setHoverSlot(index: number | null) {
    overIndexRef.current = index
    setOverIndex(index)
  }

  function slotIndexFromPoint(x: number, y: number): number | null {
    const grid = gridRef.current
    if (!grid) return null
    const hit = document.elementFromPoint(x, y)
    const slot = hit?.closest("[data-photo-slot]")
    if (!slot || !grid.contains(slot)) return null
    const index = Number(slot.getAttribute("data-photo-slot"))
    return Number.isInteger(index) ? index : null
  }

  function dropTarget(index: number | null): number | null {
    if (index === null) return null
    if (index < safeImages.length) return index
    return Math.min(index, safeImages.length)
  }

  function clearDrag() {
    if (sessionRef.current?.timer) window.clearTimeout(sessionRef.current.timer)
    sessionRef.current = null
    overIndexRef.current = null
    setDragIndex(null)
    setOverIndex(null)
  }

  function finishDrag() {
    const session = sessionRef.current
    if (!session?.active) {
      clearDrag()
      return
    }
    const from = session.from
    const to = dropTarget(overIndexRef.current)
    clearDrag()
    if (to === null || from === to) return
    if (from < 0 || from >= safeImages.length) return
    const next = reorderSlots(safeImages, from, to)
    commit(next)
    void persistOrder(next)
  }

  function onSlotPointerDown(event: ReactPointerEvent<HTMLDivElement>, index: number) {
    if (uploading || event.button !== 0) return
    const pointerId = event.pointerId
    const isTouch = event.pointerType === "touch"
    const timer = isTouch
      ? window.setTimeout(() => {
          const session = sessionRef.current
          if (!session || session.pointerId !== pointerId) return
          session.ready = true
        }, PRESS_DELAY_MS)
      : 0
    sessionRef.current = {
      pointerId,
      from: index,
      startX: event.clientX,
      startY: event.clientY,
      ready: !isTouch,
      active: false,
      timer,
    }
  }

  function onSlotPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    const distance = Math.hypot(
      event.clientX - session.startX,
      event.clientY - session.startY,
    )

    if (!session.active) {
      if (!session.ready) {
        if (distance > DRAG_THRESHOLD_PX) clearDrag()
        return
      }
      if (distance < DRAG_THRESHOLD_PX) return
      session.active = true
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragIndex(session.from)
      setHoverSlot(session.from)
    }

    event.preventDefault()
    const hover = slotIndexFromPoint(event.clientX, event.clientY)
    if (hover !== overIndexRef.current) setHoverSlot(hover)
  }

  function onSlotPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finishDrag()
  }

  useEffect(() => {
    if (dragIndex === null) return

    const blockScroll = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault()
    }
    document.addEventListener("touchmove", blockScroll, { passive: false })
    return () => document.removeEventListener("touchmove", blockScroll)
  }, [dragIndex])

  function openFilePicker() {
    replaceIndexRef.current = undefined
    inputRef.current?.click()
  }

  return (
    <div className="space-y-2">
      <p className={cn(typeMeta, "text-muted-foreground")} aria-live="polite">
        {safeImages.length}/{PRODUCT_IMAGE_MAX} · 6–10 para publicar
        {uploading ? " · Subiendo…" : ""}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        tabIndex={-1}
        aria-label="Subir fotos"
        className="sr-only"
        onChange={(event) => {
          void addFiles(event.target.files, replaceIndexRef.current)
          replaceIndexRef.current = undefined
          event.target.value = ""
        }}
      />
      <div
        ref={gridRef}
        className={cn(
          "grid grid-cols-3 gap-2 md:grid-cols-4",
          dragIndex !== null && "touch-none",
        )}
      >
        {gridSlots.map((slot, index) => (
          <div
            key={index}
            data-photo-slot={index}
            onPointerDown={
              slot ? (event) => onSlotPointerDown(event, index) : undefined
            }
            onPointerMove={slot ? onSlotPointerMove : undefined}
            onPointerUp={slot ? onSlotPointerUp : undefined}
            onPointerCancel={slot ? onSlotPointerUp : undefined}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return
              event.preventDefault()
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.files.length) return
              event.preventDefault()
              void addFiles(event.dataTransfer.files, slot ? index : undefined)
            }}
            className={cn(
              "relative aspect-square select-none rounded-lg",
              slot ? "bg-muted" : "bg-transparent",
              dragIndex === index &&
                "z-20 scale-105 touch-none opacity-80 shadow-lg",
              overIndex === index &&
                dragIndex !== null &&
                dragIndex !== index &&
                "ring-2 ring-primary",
            )}
          >
            {slot ? (
              <>
                <div className="size-full overflow-hidden rounded-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={slot.url}
                    alt=""
                    draggable={false}
                    className="pointer-events-none size-full object-cover"
                  />
                </div>
                {index === 0 ? (
                  <Badge className="pointer-events-none absolute bottom-1 left-1 z-10 h-5 max-w-[calc(100%-0.5rem)] bg-background px-1.5 text-[10px] font-medium text-foreground shadow-sm ring-1 ring-border">
                    Foto principal
                  </Badge>
                ) : null}
                <button
                  type="button"
                  aria-label={`Eliminar foto ${index + 1}`}
                  disabled={uploading}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    void remove(index)
                  }}
                  className="absolute top-1 right-1 z-10 flex size-8 items-center justify-center rounded-full bg-background/95 text-foreground shadow-sm ring-1 ring-border backdrop-blur-sm focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40"
                >
                  <XIcon className="size-3.5" />
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={uploading}
                aria-label={`Añadir foto ${index + 1}`}
                onClick={() => {
                  if (safeImages.length >= PRODUCT_IMAGE_MAX) {
                    setError(`Máximo ${PRODUCT_IMAGE_MAX} fotos.`)
                    return
                  }
                  openFilePicker()
                }}
                className="flex size-full items-center justify-center rounded-lg border border-dashed border-border hover:bg-accent disabled:pointer-events-none"
              >
                {uploading && index === safeImages.length ? (
                  <LoaderCircleIcon className="size-5 animate-spin text-primary" />
                ) : (
                  <PlusIcon className="size-5 text-muted-foreground" />
                )}
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn(typeMeta, "text-muted-foreground")}>
          Toca + para subir. Arrastra para ordenar. Se comprimen al añadir (máx. 1600px).
        </p>
        {!productId && safeImages.length > 1 ? (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs font-medium text-destructive hover:underline"
          >
            Eliminar todas ({safeImages.length})
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
