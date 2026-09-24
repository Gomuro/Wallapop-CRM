"use client"

import { useRef, useState } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ImagePlusIcon,
  Trash2Icon,
} from "lucide-react"

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

function readImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function PhotoSlots({
  images,
  onChange,
}: {
  images: string[]
  onChange: (images: string[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const slots = Array.from({ length: PRODUCT_IMAGE_MAX }, (_, index) => images[index] ?? null)
  const activeSrc = activeIndex !== null ? images[activeIndex] : null

  async function addFiles(fileList: FileList | null, atIndex?: number) {
    if (!fileList?.length) return
    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"))
    const urls = await Promise.all(files.map(readImage))
    const next = [...images]
    if (typeof atIndex === "number") {
      next[atIndex] = urls[0] ?? next[atIndex]
      urls.slice(1).forEach((url) => {
        if (next.length < PRODUCT_IMAGE_MAX) next.push(url)
      })
    } else {
      urls.forEach((url) => {
        if (next.length < PRODUCT_IMAGE_MAX) next.push(url)
      })
    }
    onChange(next.slice(0, PRODUCT_IMAGE_MAX))
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= images.length) return
    const next = [...images]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
    setActiveIndex(target)
  }

  function remove(index: number) {
    onChange(images.filter((_, itemIndex) => itemIndex !== index))
    setActiveIndex(null)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">Photos</p>
        <p className="text-xs text-muted-foreground">
          {images.length}/{PRODUCT_IMAGE_MAX} · 6–10 for posting
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(event) => {
          void addFiles(event.target.files, activeIndex ?? undefined)
          event.target.value = ""
        }}
      />
      <div className="grid grid-cols-4 gap-2">
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
              const next = [...images]
              const [moved] = next.splice(dragIndex, 1)
              next.splice(Math.min(index, next.length), 0, moved)
              onChange(next)
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
            className="relative aspect-square overflow-hidden rounded-lg border border-dashed border-input bg-muted/40"
            aria-label={src ? `Photo ${index + 1}` : `Add photo ${index + 1}`}
          >
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" className="size-full object-cover" />
            ) : (
              <ImagePlusIcon className="mx-auto size-5 text-muted-foreground" />
            )}
            {index === 0 && src ? (
              <span className="absolute bottom-1 left-1 rounded bg-background/90 px-1 text-[10px] font-medium">
                Cover
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Tap a slot to upload. Drag to reorder. Drop images onto empty slots.
      </p>

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
                disabled={activeIndex === null || activeIndex >= images.length - 1}
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
