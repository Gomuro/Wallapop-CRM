"use client"

import { useRef, useState } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"

import { uploadProductImages } from "@/app/actions/uploads"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { PRODUCT_IMAGE_MAX } from "@/lib/validations/product"
import { useIsMd } from "@/lib/ui/media"
import { typeMeta } from "@/lib/ui/type"
import { cn } from "@/lib/utils"

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"]

function compactImages(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
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
  const isMd = useIsMd()
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const safeImages = compactImages(images)
  const slots = Array.from(
    { length: PRODUCT_IMAGE_MAX },
    (_, index) => safeImages[index] ?? null,
  )
  const activeSrc =
    activeIndex !== null ? (safeImages[activeIndex] ?? null) : null
  const editorOpen = activeSrc !== null

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
    const target = index + direction
    if (target < 0 || target >= safeImages.length) return
    const next = [...safeImages]
    const current = next[index]
    const swapped = next[target]
    if (!current || !swapped) return
    next[index] = swapped
    next[target] = current
    commit(next)
    setActiveIndex(target)
  }

  function makeCover(index: number) {
    if (index <= 0 || index >= safeImages.length) return
    const next = [...safeImages]
    const [item] = next.splice(index, 1)
    if (!item) return
    next.unshift(item)
    commit(next)
    setActiveIndex(0)
  }

  function remove(index: number) {
    commit(safeImages.filter((_, itemIndex) => itemIndex !== index))
    setActiveIndex(null)
  }

  function clearDrag() {
    setDragIndex(null)
    setOverIndex(null)
  }

  const editorActions = (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11"
          aria-label="Move left"
          disabled={uploading || activeIndex === 0}
          onClick={() => activeIndex !== null && move(activeIndex, -1)}
        >
          <ChevronLeftIcon />
          Left
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          aria-label="Move right"
          disabled={
            uploading || activeIndex === null || activeIndex >= safeImages.length - 1
          }
          onClick={() => activeIndex !== null && move(activeIndex, 1)}
        >
          Right
          <ChevronRightIcon />
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="h-11"
          aria-label="Delete photo"
          disabled={uploading}
          onClick={() => activeIndex !== null && remove(activeIndex)}
        >
          <Trash2Icon />
        </Button>
      </div>
      {activeIndex !== null && activeIndex > 0 ? (
        <Button
          type="button"
          variant="secondary"
          className="h-11 w-full"
          disabled={uploading}
          onClick={() => makeCover(activeIndex)}
        >
          Set as main
        </Button>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        className="h-11 w-full"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? <LoaderCircleIcon className="animate-spin" /> : null}
        Replace photo
      </Button>
    </div>
  )

  const preview = activeSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={activeSrc}
      alt=""
      className="mx-auto max-h-72 w-full rounded-lg bg-muted object-contain"
    />
  ) : null

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
          void addFiles(event.target.files, activeIndex ?? undefined)
          event.target.value = ""
        }}
      />
      <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
        {slots.map((src, index) => (
          <button
            key={index}
            type="button"
            draggable={Boolean(src) && !uploading}
            onDragStart={() => setDragIndex(index)}
            onDragEnd={clearDrag}
            onDragOver={(event) => {
              event.preventDefault()
              setOverIndex(index)
            }}
            onDragLeave={() => {
              setOverIndex((current) => (current === index ? null : current))
            }}
            onDrop={(event) => {
              event.preventDefault()
              const from = dragIndex
              clearDrag()
              if (event.dataTransfer.files.length) {
                void addFiles(event.dataTransfer.files, src ? index : undefined)
                return
              }
              if (from === null || from === index) return
              const next = [...safeImages]
              if (from < 0 || from >= next.length) return
              const [moved] = next.splice(from, 1)
              if (!moved) return
              next.splice(Math.min(index, next.length), 0, moved)
              commit(next)
            }}
            onClick={() => {
              if (src) {
                setActiveIndex(index)
                return
              }
              if (safeImages.length >= PRODUCT_IMAGE_MAX) {
                setError(`Maximum ${PRODUCT_IMAGE_MAX} photos.`)
                return
              }
              setActiveIndex(null)
              inputRef.current?.click()
            }}
            className={cn(
              "relative flex aspect-square items-center justify-center overflow-hidden rounded-lg transition-shadow",
              src
                ? "border-0 bg-muted hover:ring-2 hover:ring-primary/40"
                : "border border-dashed border-border bg-transparent hover:bg-accent",
              dragIndex === index && "opacity-50",
              overIndex === index && dragIndex !== null && "ring-2 ring-primary",
            )}
            disabled={uploading}
            aria-label={src ? `Photo ${index + 1}` : `Add photo ${index + 1}`}
          >
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" className="size-full object-cover" />
            ) : uploading && index === safeImages.length ? (
              <LoaderCircleIcon className="size-5 animate-spin text-primary" />
            ) : (
              <PlusIcon className="size-5 text-muted-foreground" />
            )}
            {index === 0 && src ? (
              <Badge className="absolute top-1 left-1 z-10 h-5 max-w-[calc(100%-0.5rem)] bg-background px-1.5 text-[10px] font-medium text-foreground shadow-sm ring-1 ring-border">
                Головне
              </Badge>
            ) : null}
          </button>
        ))}
      </div>
      <p className={cn(typeMeta, "text-muted-foreground")}>
        Tap a slot to upload. Drag to reorder. JPEG/PNG/WebP, max 10MB. EXIF is
        stripped on save.
      </p>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {isMd ? (
        <Dialog
          open={editorOpen}
          onOpenChange={(open) => {
            if (!open) setActiveIndex(null)
          }}
        >
          <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Photo {(activeIndex ?? 0) + 1}</DialogTitle>
            </DialogHeader>
            {preview}
            {editorActions}
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer
          open={editorOpen}
          onOpenChange={(open) => {
            if (!open) setActiveIndex(null)
          }}
          showSwipeHandle
        >
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Photo {(activeIndex ?? 0) + 1}</DrawerTitle>
            </DrawerHeader>
            {activeSrc ? <div className="px-4">{preview}</div> : null}
            <DrawerFooter>
              {editorActions}
              <DrawerClose render={<Button variant="ghost" className="h-12 w-full" />}>
                Close
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  )
}
