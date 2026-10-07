"use client"

import type {
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react"
import { LoaderCircleIcon, PlusIcon, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { typeMeta } from "@/lib/ui/type"
import { PRODUCT_IMAGE_MAX } from "@/lib/validations/product"
import { cn } from "@/lib/utils"

type SlotImage = {
  url: string
  id?: string
  file?: File
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
