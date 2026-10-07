"use client"

import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
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

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]
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

type PhotoSlotDragRefs = {
  sessionRef: MutableRefObject<DragSession | null>
  overIndexRef: MutableRefObject<number | null>
  gridRef: RefObject<HTMLDivElement | null>
}

function mapProductImages(productImages: InventoryProductImage[]): SlotImage[] {
  return productImages
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((image) => ({ url: image.url, id: image.id }))
}

function roomForPhotos(safeImages: SlotImage[], atIndex?: number) {
  const replacing =
    typeof atIndex === "number" && atIndex >= 0 && atIndex < safeImages.length
  return replacing
    ? PRODUCT_IMAGE_MAX - safeImages.length + 1
    : PRODUCT_IMAGE_MAX - safeImages.length
}

async function persistPhotoSlotOrder(
  productId: string | undefined,
  next: SlotImage[],
  setError: (error: string | null) => void,
) {
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

async function addPhotoSlotFiles(ctx: {
  fileList: FileList | null
  atIndex?: number
  uploading: boolean
  productId?: string
  safeImages: SlotImage[]
  setUploading: (value: boolean) => void
  setError: (error: string | null) => void
  commit: (next: SlotImage[]) => void
}) {
  if (!ctx.fileList?.length || ctx.uploading) return
  const incoming = Array.from(ctx.fileList)
  const valid = incoming.filter(
    (file) =>
      ACCEPTED_TYPES.includes(file.type?.toLowerCase()) ||
      /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name),
  )
  const rejectedType = incoming.length - valid.length
  if (valid.length === 0) {
    ctx.setError("Usa fotos en formato JPEG, PNG, WebP o HEIC.")
    return
  }

  const room = roomForPhotos(ctx.safeImages, ctx.atIndex)
  if (room <= 0) {
    ctx.setError(`Máximo ${PRODUCT_IMAGE_MAX} fotos.`)
    return
  }

  const accepted = valid.slice(0, room)
  const skipped = valid.length - accepted.length

  ctx.setUploading(true)
  ctx.setError(null)
  let compressed: File[]
  try {
    compressed = await compressImageFiles(accepted)
  } catch (err) {
    ctx.setUploading(false)
    const message =
      err instanceof Error ? err.message : "No se pudieron procesar las fotos."
    ctx.setError(message)
    return
  }

  if (ctx.productId) {
    const formData = new FormData()
    compressed.forEach((file) => formData.append("files", file))
    try {
      const result = await uploadProductImages(formData, ctx.productId)
      if (result.error || result.urls.length === 0) {
        ctx.setError(result.error ?? "No se pudo guardar la imagen.")
        return
      }
      const uploaded = result.urls.map((url, index) => ({
        url,
        id: result.imageIds?.[index],
      }))
      const next = [...ctx.safeImages]
      if (
        typeof ctx.atIndex === "number" &&
        ctx.atIndex >= 0 &&
        ctx.atIndex < next.length
      ) {
        next.splice(ctx.atIndex, 1, ...uploaded)
      } else {
        next.push(...uploaded)
      }
      ctx.commit(next.slice(0, PRODUCT_IMAGE_MAX))
    } catch (error) {
      if (isNextRedirect(error)) throw error
      ctx.setError(actionFailureMessage(error))
      return
    } finally {
      ctx.setUploading(false)
    }
  } else {
    const added: SlotImage[] = compressed.map((file) => ({
      url: URL.createObjectURL(file),
      file,
    }))
    const next = [...ctx.safeImages]
    if (
      typeof ctx.atIndex === "number" &&
      ctx.atIndex >= 0 &&
      ctx.atIndex < next.length
    ) {
      const old = next[ctx.atIndex]
      if (old?.url.startsWith("blob:")) URL.revokeObjectURL(old.url)
      next.splice(ctx.atIndex, 1, ...added)
    } else {
      next.push(...added)
    }
    ctx.commit(next.slice(0, PRODUCT_IMAGE_MAX))
    ctx.setUploading(false)
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
  if (notes.length > 0) ctx.setError(notes.join(" "))
}

async function removePhotoSlot(ctx: {
  index: number
  productId?: string
  safeImages: SlotImage[]
  setUploading: (value: boolean) => void
  setError: (error: string | null) => void
  commit: (next: SlotImage[]) => void
}) {
  const target = ctx.safeImages[ctx.index]
  if (!target) return
  if (ctx.productId && target.id) {
    ctx.setUploading(true)
    try {
      const result = await deleteProductImageAction(ctx.productId, target.id)
      if (result.error) {
        ctx.setError(result.error)
        return
      }
    } catch (error) {
      if (isNextRedirect(error)) throw error
      ctx.setError(actionFailureMessage(error))
      return
    } finally {
      ctx.setUploading(false)
    }
  }
  if (target.url.startsWith("blob:")) URL.revokeObjectURL(target.url)
  const next = ctx.safeImages.filter((_, itemIndex) => itemIndex !== ctx.index)
  ctx.commit(next)
  if (ctx.productId) await persistPhotoSlotOrder(ctx.productId, next, ctx.setError)
}

function slotIndexFromPoint(
  gridRef: RefObject<HTMLDivElement | null>,
  x: number,
  y: number,
): number | null {
  const grid = gridRef.current
  if (!grid) return null
  const hit = document.elementFromPoint(x, y)
  const slot = hit?.closest("[data-photo-slot]")
  if (!slot || !grid.contains(slot)) return null
  const index = Number(slot.getAttribute("data-photo-slot"))
  return Number.isInteger(index) ? index : null
}

function photoSlotDropTarget(index: number | null, imageCount: number): number | null {
  if (index === null) return null
  if (index < imageCount) return index
  return Math.min(index, imageCount)
}

function clearPhotoSlotDrag(
  refs: PhotoSlotDragRefs,
  setDragIndex: (value: number | null) => void,
  setOverIndex: (value: number | null) => void,
) {
  if (refs.sessionRef.current?.timer) {
    window.clearTimeout(refs.sessionRef.current.timer)
  }
  refs.sessionRef.current = null
  refs.overIndexRef.current = null
  setDragIndex(null)
  setOverIndex(null)
}

export function startPhotoSlotDrag(
  event: ReactPointerEvent<HTMLDivElement>,
  index: number,
  uploading: boolean,
  sessionRef: MutableRefObject<DragSession | null>,
) {
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

export function movePhotoSlotDrag(
  event: ReactPointerEvent<HTMLDivElement>,
  refs: PhotoSlotDragRefs,
  setDragIndex: (value: number | null) => void,
  setOverIndex: (value: number | null) => void,
) {
  const session = refs.sessionRef.current
  if (!session || session.pointerId !== event.pointerId) return
  const distance = Math.hypot(
    event.clientX - session.startX,
    event.clientY - session.startY,
  )

  if (!session.active) {
    if (!session.ready) {
      if (distance > DRAG_THRESHOLD_PX) {
        clearPhotoSlotDrag(refs, setDragIndex, setOverIndex)
      }
      return
    }
    if (distance < DRAG_THRESHOLD_PX) return
    session.active = true
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragIndex(session.from)
    refs.overIndexRef.current = session.from
    setOverIndex(session.from)
  }

  event.preventDefault()
  const hover = slotIndexFromPoint(refs.gridRef, event.clientX, event.clientY)
  if (hover !== refs.overIndexRef.current) {
    refs.overIndexRef.current = hover
    setOverIndex(hover)
  }
}

export function finishPhotoSlotDrag(
  event: ReactPointerEvent<HTMLDivElement>,
  ctx: PhotoSlotDragRefs & {
    safeImages: SlotImage[]
    productId?: string
    setDragIndex: (value: number | null) => void
    setOverIndex: (value: number | null) => void
    setError: (error: string | null) => void
    commit: (next: SlotImage[]) => void
  },
) {
  const session = ctx.sessionRef.current
  if (!session || session.pointerId !== event.pointerId) return
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
  if (!session.active) {
    clearPhotoSlotDrag(ctx, ctx.setDragIndex, ctx.setOverIndex)
    return
  }
  const from = session.from
  const to = photoSlotDropTarget(ctx.overIndexRef.current, ctx.safeImages.length)
  clearPhotoSlotDrag(ctx, ctx.setDragIndex, ctx.setOverIndex)
  if (to === null || from === to) return
  if (from < 0 || from >= ctx.safeImages.length) return
  const next = reorderSlots(ctx.safeImages, from, to)
  ctx.commit(next)
  void persistPhotoSlotOrder(ctx.productId, next, ctx.setError)
}

export function PhotoSlotCell({
  index,
  slot,
  imageCount,
  dragIndex,
  overIndex,
  uploading,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onAddFiles,
  onRemove,
  onOpenPicker,
  onMaxReached,
}: {
  index: number
  slot: SlotImage | null
  imageCount: number
  dragIndex: number | null
  overIndex: number | null
  uploading: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, index: number) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onAddFiles: (files: FileList | null, atIndex?: number) => void
  onRemove: (index: number) => void
  onOpenPicker: () => void
  onMaxReached: () => void
}) {
  return (
    <div
      data-photo-slot={index}
      onPointerDown={slot ? (event) => onPointerDown(event, index) : undefined}
      onPointerMove={slot ? onPointerMove : undefined}
      onPointerUp={slot ? onPointerUp : undefined}
      onPointerCancel={slot ? onPointerUp : undefined}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return
        event.preventDefault()
        void onAddFiles(event.dataTransfer.files, slot ? index : undefined)
      }}
      className={cn(
        "relative aspect-square select-none rounded-lg",
        slot ? "bg-muted" : "bg-transparent",
        dragIndex === index && "z-20 scale-105 touch-none opacity-80 shadow-lg",
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
              void onRemove(index)
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
            if (imageCount >= PRODUCT_IMAGE_MAX) {
              onMaxReached()
              return
            }
            onOpenPicker()
          }}
          className="flex size-full items-center justify-center rounded-lg border border-dashed border-border hover:bg-accent disabled:pointer-events-none"
        >
          {uploading && index === imageCount ? (
            <LoaderCircleIcon className="size-5 animate-spin text-primary" />
          ) : (
            <PlusIcon className="size-5 text-muted-foreground" />
          )}
        </button>
      )}
    </div>
  )
}

type PhotoSlotsGridProps = {
  inputRef: RefObject<HTMLInputElement | null>
  gridRef: RefObject<HTMLDivElement | null>
  replaceIndexRef: MutableRefObject<number | undefined>
  gridSlots: (SlotImage | null)[]
  imageCount: number
  productId?: string
  dragIndex: number | null
  overIndex: number | null
  uploading: boolean
  error: string | null
  onAddFiles: (files: FileList | null, atIndex?: number) => void
  onRemove: (index: number) => void
  onClearAll: () => void
  onOpenPicker: () => void
  onMaxReached: () => void
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, index: number) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
}

function subscribeDraftPhotoSlots(
  productId: string | undefined,
  restoreDraft: boolean,
  setSlots: (slots: SlotImage[]) => void,
) {
  if (productId || !restoreDraft) return
  let cancelled = false
  void loadDraftPhotos().then(async (files) => {
    if (cancelled || files.length === 0) return
    const compressed = await compressImageFiles(files.slice(0, PRODUCT_IMAGE_MAX))
    if (cancelled) return
    setSlots(compressed.map((file) => ({ url: URL.createObjectURL(file), file })))
  })
  return () => {
    cancelled = true
  }
}

export function PhotoSlotsGrid({
  inputRef,
  gridRef,
  replaceIndexRef,
  gridSlots,
  imageCount,
  productId,
  dragIndex,
  overIndex,
  uploading,
  error,
  onAddFiles,
  onRemove,
  onClearAll,
  onOpenPicker,
  onMaxReached,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: PhotoSlotsGridProps) {
  return (
    <div className="space-y-2">
      <p className={cn(typeMeta, "text-muted-foreground")} aria-live="polite">
        {imageCount}/{PRODUCT_IMAGE_MAX} · 6–10 para publicar
        {uploading ? " · Subiendo…" : ""}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,image/*"
        multiple
        tabIndex={-1}
        aria-label="Subir fotos"
        className="sr-only"
        onChange={(event) => {
          void onAddFiles(event.target.files, replaceIndexRef.current)
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
          <PhotoSlotCell
            key={index}
            index={index}
            slot={slot}
            imageCount={imageCount}
            dragIndex={dragIndex}
            overIndex={overIndex}
            uploading={uploading}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onAddFiles={onAddFiles}
            onRemove={onRemove}
            onOpenPicker={onOpenPicker}
            onMaxReached={onMaxReached}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn(typeMeta, "text-muted-foreground")}>
          Toca + para subir. Arrastra para ordenar. Se comprimen al añadir (máx. 1400px).
        </p>
        {!productId && imageCount > 1 ? (
          <button
            type="button"
            onClick={onClearAll}
            className="text-xs font-medium text-destructive hover:underline"
          >
            Eliminar todas ({imageCount})
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

export type PhotoSlotsProps = {
  productId?: string
  productImages?: InventoryProductImage[]
  restoreDraft?: boolean
  onPendingFilesChange?: (files: File[]) => void
}

export function PhotoSlots({
  productId,
  productImages = [],
  restoreDraft = false,
  onPendingFilesChange,
}: PhotoSlotsProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<DragSession | null>(null)
  const overIndexRef = useRef<number | null>(null)
  const replaceIndexRef = useRef<number | undefined>(undefined)
  const [slots, setSlots] = useState<SlotImage[]>(() =>
    mapProductImages(productImages),
  )
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dragRefs: PhotoSlotDragRefs = { sessionRef, overIndexRef, gridRef }

  useEffect(() => {
    if (productId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync slot state when server updates product images
      setSlots(mapProductImages(productImages))
    }
  }, [productId, productImages])

  useEffect(
    () => subscribeDraftPhotoSlots(productId, restoreDraft, setSlots),
    [productId, restoreDraft],
  )

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

  useEffect(() => {
    if (dragIndex === null) return
    const blockScroll = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault()
    }
    document.addEventListener("touchmove", blockScroll, { passive: false })
    return () => document.removeEventListener("touchmove", blockScroll)
  }, [dragIndex])

  const safeImages = slots
  const gridSlots = Array.from(
    { length: PRODUCT_IMAGE_MAX },
    (_, index) => safeImages[index] ?? null,
  )
  function commit(next: SlotImage[]) {
    setSlots(next.slice(0, PRODUCT_IMAGE_MAX))
  }

  return (
    <PhotoSlotsGrid
      inputRef={inputRef}
      gridRef={gridRef}
      replaceIndexRef={replaceIndexRef}
      gridSlots={gridSlots}
      imageCount={safeImages.length}
      productId={productId}
      dragIndex={dragIndex}
      overIndex={overIndex}
      uploading={uploading}
      error={error}
      onAddFiles={(fileList, atIndex) =>
        void addPhotoSlotFiles({
          fileList,
          atIndex,
          uploading,
          productId,
          safeImages,
          setUploading,
          setError,
          commit,
        })
      }
      onRemove={(index) =>
        void removePhotoSlot({
          index,
          productId,
          safeImages,
          setUploading,
          setError,
          commit,
        })
      }
      onClearAll={() => {
        safeImages.forEach((s) => {
          if (s.url.startsWith("blob:")) URL.revokeObjectURL(s.url)
        })
        setSlots([])
        setError(null)
      }}
      onOpenPicker={() => {
        replaceIndexRef.current = undefined
        inputRef.current?.click()
      }}
      onMaxReached={() => setError(`Máximo ${PRODUCT_IMAGE_MAX} fotos.`)}
      onPointerDown={(event, index) =>
        startPhotoSlotDrag(event, index, uploading, sessionRef)
      }
      onPointerMove={(event) =>
        movePhotoSlotDrag(event, dragRefs, setDragIndex, setOverIndex)
      }
      onPointerUp={(event) =>
        finishPhotoSlotDrag(event, {
          ...dragRefs,
          safeImages,
          productId,
          setDragIndex,
          setOverIndex,
          setError,
          commit,
        })
      }
    />
  )
}
