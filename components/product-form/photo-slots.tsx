"use client"

import { useRef, useState, type ReactNode } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"

import { uploadProductImages } from "@/app/actions/uploads"
import { Badge } from "@/components/ui/badge"
import { PRODUCT_IMAGE_MAX } from "@/lib/validations/product"
import { typeMeta } from "@/lib/ui/type"
import { cn } from "@/lib/utils"

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"]

const PHOTO_SLOT_MIME = "application/x-wallapop-photo-slot"

function compactImages(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  )
}

function reorderPhotos(images: string[], from: number, to: number): string[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= images.length
  ) {
    return images
  }

  const next = [...images]
  const [moved] = next.splice(from, 1)
  if (!moved) return images
  next.splice(Math.min(to, next.length), 0, moved)
  return next
}

function readSlotIndex(dataTransfer: DataTransfer): number | null {
  const raw =
    dataTransfer.getData(PHOTO_SLOT_MIME) || dataTransfer.getData("text/plain")
  if (!raw) return null
  const index = Number.parseInt(raw, 10)
  return Number.isInteger(index) ? index : null
}

function SlotControl({
  label,
  disabled,
  className,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  className?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      draggable={false}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        event.preventDefault()
        onClick()
      }}
      className={cn(
        "absolute z-10 flex size-8 items-center justify-center rounded-full bg-background/95 text-foreground shadow-sm ring-1 ring-border backdrop-blur-sm",
        "transition-opacity focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  )
}

export function PhotoSlots({
  images = [],
  onChange,
}: {
  images?: string[]
  onChange: (images: string[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dragIndexRef = useRef<number | null>(null)
  const replaceIndexRef = useRef<number | undefined>(undefined)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const safeImages = compactImages(images)
  const slots = Array.from(
    { length: PRODUCT_IMAGE_MAX },
    (_, index) => safeImages[index] ?? null,
  )
  const lastFilled = safeImages.length - 1

  function commit(next: string[]) {
    onChange(compactImages(next).slice(0, PRODUCT_IMAGE_MAX))
  }

  function roomFor(atIndex?: number) {
    const replacing =
      typeof atIndex === "number" && atIndex >= 0 && atIndex < safeImages.length
    return replacing
      ? PRODUCT_IMAGE_MAX - safeImages.length + 1
      : PRODUCT_IMAGE_MAX - safeImages.length
  }

  async function addFiles(fileList: FileList | null, atIndex?: number) {
    if (!fileList?.length || uploading) return
    const incoming = Array.from(fileList)
    const valid = incoming.filter((file) => ACCEPTED_TYPES.includes(file.type))
    const rejectedType = incoming.length - valid.length
    if (valid.length === 0) {
      setError("Use JPEG, PNG, or WebP.")
      return
    }

    const room = roomFor(atIndex)
    if (room <= 0) {
      setError(`Maximum ${PRODUCT_IMAGE_MAX} photos.`)
      return
    }

    const accepted = valid.slice(0, room)
    const skipped = valid.length - accepted.length
    const formData = new FormData()
    accepted.forEach((file) => formData.append("files", file))
    setUploading(true)
    setError(null)
    try {
      const result = await uploadProductImages(formData)
      if (result.error || result.urls.length === 0) {
        setError(result.error ?? "Could not save image.")
        return
      }

      const urls = result.urls
      const next = [...safeImages]
      if (typeof atIndex === "number" && atIndex >= 0 && atIndex < next.length) {
        next[atIndex] = urls[0] ?? next[atIndex]
        urls.slice(1).forEach((url) => {
          if (next.length < PRODUCT_IMAGE_MAX) next.push(url)
        })
      } else {
        urls.forEach((url) => {
          if (next.length < PRODUCT_IMAGE_MAX) next.push(url)
        })
      }
      commit(next)
      const notes: string[] = []
      if (skipped > 0) {
        notes.push(
          `Maximum ${PRODUCT_IMAGE_MAX} photos. Extra files were not added.`,
        )
      }
      if (rejectedType > 0) {
        notes.push("Some files were skipped. Use JPEG, PNG, or WebP.")
      }
      setError(notes.length > 0 ? notes.join(" ") : null)
    } catch {
      setError("Could not save image.")
    } finally {
      setUploading(false)
    }
  }

  function move(index: number, direction: -1 | 1) {
    commit(reorderPhotos(safeImages, index, index + direction))
  }

  function remove(index: number) {
    commit(safeImages.filter((_, itemIndex) => itemIndex !== index))
  }

  function setDragSource(index: number | null) {
    dragIndexRef.current = index
    setDragIndex(index)
  }

  function clearDrag() {
    dragIndexRef.current = null
    setDragIndex(null)
    setOverIndex(null)
  }

  function openFilePicker(atIndex?: number) {
    replaceIndexRef.current = atIndex
    inputRef.current?.click()
  }

  return (
    <div className="space-y-2">
      <p className={cn(typeMeta, "text-muted-foreground")} aria-live="polite">
        {safeImages.length}/{PRODUCT_IMAGE_MAX} · 6–10 for posting
        {uploading ? " · Uploading…" : ""}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        tabIndex={-1}
        aria-label="Upload photos"
        className="sr-only"
        onChange={(event) => {
          void addFiles(event.target.files, replaceIndexRef.current)
          replaceIndexRef.current = undefined
          event.target.value = ""
        }}
      />
      <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
        {slots.map((src, index) => (
          <div
            key={index}
            draggable={Boolean(src) && !uploading}
            onDragStart={(event) => {
              if (!src || uploading) {
                event.preventDefault()
                return
              }
              event.dataTransfer.effectAllowed = "move"
              event.dataTransfer.setData(PHOTO_SLOT_MIME, String(index))
              event.dataTransfer.setData("text/plain", String(index))
              setDragSource(index)
            }}
            onDragEnd={clearDrag}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect =
                dragIndexRef.current !== null ? "move" : "copy"
              if (overIndex !== index) setOverIndex(index)
            }}
            onDragLeave={() => {
              setOverIndex((current) => (current === index ? null : current))
            }}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation()
              const from =
                dragIndexRef.current ?? readSlotIndex(event.dataTransfer)
              const files = event.dataTransfer.files
              clearDrag()

              if (from !== null) {
                if (from === index) return
                if (from < 0 || from >= safeImages.length) return
                const to = src ? index : Math.min(index, safeImages.length)
                commit(reorderPhotos(safeImages, from, to))
                return
              }

              if (files.length) {
                void addFiles(files, src ? index : undefined)
              }
            }}
            className={cn(
              "relative aspect-square overflow-hidden rounded-lg",
              src ? "bg-muted" : "bg-transparent",
              dragIndex === index && "opacity-50",
              overIndex === index && dragIndex !== null && "ring-2 ring-primary",
            )}
          >
            {src ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  className="size-full object-cover"
                />
                {index === 0 ? (
                  <Badge className="absolute top-1 left-1 z-10 h-5 max-w-[calc(100%-2.5rem)] bg-background px-1.5 text-[10px] font-medium text-foreground shadow-sm ring-1 ring-border">
                    Головне
                  </Badge>
                ) : null}
                <SlotControl
                  label={`Delete photo ${index + 1}`}
                  disabled={uploading}
                  className="top-1 right-1"
                  onClick={() => remove(index)}
                >
                  <XIcon className="size-3.5" />
                </SlotControl>
                <SlotControl
                  label={`Move photo ${index + 1} left`}
                  disabled={uploading || index === 0}
                  className="bottom-1 left-1"
                  onClick={() => move(index, -1)}
                >
                  <ChevronLeftIcon className="size-3.5" />
                </SlotControl>
                <SlotControl
                  label={`Move photo ${index + 1} right`}
                  disabled={uploading || index >= lastFilled}
                  className="bottom-1 right-1"
                  onClick={() => move(index, 1)}
                >
                  <ChevronRightIcon className="size-3.5" />
                </SlotControl>
              </>
            ) : (
              <button
                type="button"
                disabled={uploading}
                aria-label={`Add photo ${index + 1}`}
                onClick={() => {
                  if (safeImages.length >= PRODUCT_IMAGE_MAX) {
                    setError(`Maximum ${PRODUCT_IMAGE_MAX} photos.`)
                    return
                  }
                  openFilePicker()
                }}
                className="flex size-full items-center justify-center border border-dashed border-border hover:bg-accent disabled:pointer-events-none"
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
      <p className={cn(typeMeta, "text-muted-foreground")}>
        Tap + to upload. Use arrows or drag to reorder. JPEG/PNG/WebP, max 10MB.
        EXIF is stripped on save.
      </p>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
