"use client"

import { useRef, useState } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"

import { uploadProductImages } from "@/app/actions/uploads"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { PRODUCT_IMAGE_MAX } from "@/lib/validations/product"
import { typeMeta } from "@/lib/ui/type"
import { cn } from "@/lib/utils"

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
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const safeImages = compactImages(images)
  const slots = Array.from(
    { length: PRODUCT_IMAGE_MAX },
    (_, index) => safeImages[index] ?? null,
  )
  const activeSrc =
    activeIndex !== null ? (safeImages[activeIndex] ?? null) : null

  function commit(next: string[]) {
    onChange(compactImages(next).slice(0, PRODUCT_IMAGE_MAX))
  }

  async function addFiles(fileList: FileList | null, atIndex?: number) {
    if (!fileList?.length) return
    const files = Array.from(fileList).filter((file) =>
      ["image/jpeg", "image/png", "image/webp"].includes(file.type),
    )
    if (files.length === 0) {
      setError("Use JPEG, PNG, or WebP.")
      return
    }

    const formData = new FormData()
    files.forEach((file) => formData.append("files", file))
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

  function remove(index: number) {
    commit(safeImages.filter((_, itemIndex) => itemIndex !== index))
    setActiveIndex(null)
  }

  return (
    <div className="space-y-2">
      <p className={cn(typeMeta, "text-muted-foreground")}>
        {safeImages.length}/{PRODUCT_IMAGE_MAX} · 6–10 for posting
        {uploading ? " · Uploading…" : ""}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        onChange={(event) => {
          void addFiles(event.target.files, activeIndex ?? undefined)
          event.target.value = ""
        }}
      />
      <div className="grid grid-cols-3 gap-2">
        {slots.map((src, index) => (
          <button
            key={index}
            type="button"
            draggable={Boolean(src)}
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              if (event.dataTransfer.files.length) {
                void addFiles(event.dataTransfer.files, src ? index : undefined)
                setDragIndex(null)
                return
              }
              if (dragIndex === null || dragIndex === index) return
              const next = [...safeImages]
              if (dragIndex < 0 || dragIndex >= next.length) {
                setDragIndex(null)
                return
              }
              const [moved] = next.splice(dragIndex, 1)
              if (!moved) {
                setDragIndex(null)
                return
              }
              next.splice(Math.min(index, next.length), 0, moved)
              commit(next)
              setDragIndex(null)
            }}
            onClick={() => {
              if (src) {
                setActiveIndex(index)
                return
              }
              setActiveIndex(null)
              inputRef.current?.click()
            }}
            className={cn(
              "relative flex aspect-square items-center justify-center overflow-hidden rounded-lg",
              src
                ? "border-0 bg-transparent"
                : "border border-dashed border-muted-foreground/30 bg-transparent",
            )}
            disabled={uploading}
            aria-label={src ? `Photo ${index + 1}` : `Add photo ${index + 1}`}
          >
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" className="size-full object-cover" />
            ) : (
              <PlusIcon className="size-5 text-muted-foreground" />
            )}
            {index === 0 ? (
              <Badge className="absolute top-1 left-1 z-10 h-5 bg-accent px-1.5 text-[10px] font-medium text-accent-foreground shadow-sm">
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

      <Drawer open={activeSrc !== null} onOpenChange={(open) => !open && setActiveIndex(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Photo {(activeIndex ?? 0) + 1}</DrawerTitle>
          </DrawerHeader>
          {activeSrc ? (
            <div className="px-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={activeSrc}
                alt=""
                className="mx-auto max-h-56 w-full rounded-lg object-cover"
              />
            </div>
          ) : null}
          <DrawerFooter>
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={activeIndex === 0}
                onClick={() => activeIndex !== null && move(activeIndex, -1)}
              >
                <ChevronLeftIcon />
                Left
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={activeIndex === null || activeIndex >= safeImages.length - 1}
                onClick={() => activeIndex !== null && move(activeIndex, 1)}
              >
                Right
                <ChevronRightIcon />
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => activeIndex !== null && remove(activeIndex)}
              >
                <Trash2Icon />
              </Button>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => inputRef.current?.click()}
            >
              Replace photo
            </Button>
            <DrawerClose render={<Button variant="ghost" className="w-full" />}>
              Close
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
