"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react"

import { ImageLightbox } from "@/components/catalog/image-lightbox"
import { GALLERY_SIZES, ProductImage } from "@/components/catalog/product-image"
import {
  rubberbandOffset,
  setSlideTrack,
  settleSwipeIndex,
} from "@/lib/ui/swipe-carousel"
import { cn } from "@/lib/utils"

export function ProductGallery({
  images = [],
  alt,
}: {
  images?: string[]
  alt: string
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    lastX: number
    lastT: number
    vx: number
    moved: boolean
  } | null>(null)
  const [active, setActive] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const safeImages = Array.isArray(images)
    ? images.filter(
        (src) =>
          typeof src === "string" &&
          src.length > 0 &&
          !(src.startsWith("data:") && src.length > 8_000),
      )
    : []
  const count = safeImages.length

  const goTo = useCallback(
    (index: number, animate = true) => {
      const next = Math.min(count - 1, Math.max(0, index))
      setActive(next)
      setSlideTrack(trackRef.current, next, 0, animate)
    },
    [count],
  )

  useEffect(() => {
    setSlideTrack(trackRef.current, active, 0, true)
  }, [active])

  function openLightbox(index: number) {
    setLightboxIndex(index)
    setLightboxOpen(true)
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (count === 0 || event.button !== 0) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastT: performance.now(),
      vx: 0,
      moved: false,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic or already-released pointers have no capture target.
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || count < 2) return

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.hypot(dx, dy) > 8) {
      drag.moved = true
      setDragging(true)
    }
    if (!drag.moved) return

    const now = performance.now()
    drag.vx = (event.clientX - drag.lastX) / Math.max(1, now - drag.lastT)
    drag.lastX = event.clientX
    drag.lastT = now

    const resist = (active === 0 && dx > 0) || (active === count - 1 && dx < 0)
    setSlideTrack(trackRef.current, active, rubberbandOffset(dx, resist), false)
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)

    if (!drag.moved) {
      if (!cancelled) openLightbox(active)
      return
    }

    const dx = event.clientX - drag.startX
    const width = viewportRef.current?.clientWidth ?? 0
    goTo(settleSwipeIndex({ active, count, dx, width, vx: drag.vx }))
  }

  return (
    <>
      <div
        ref={viewportRef}
        className="group relative min-w-0 overflow-hidden bg-muted select-none lg:rounded-xl"
        tabIndex={count > 1 ? 0 : undefined}
        role={count > 1 ? "region" : undefined}
        aria-roledescription={count > 1 ? "carousel" : undefined}
        aria-label={count > 1 ? `${alt}. Foto ${active + 1} de ${count}` : alt}
        onKeyDown={(event) => {
          if (count < 2) return
          if (event.key === "ArrowRight") {
            event.preventDefault()
            goTo(active + 1)
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault()
            goTo(active - 1)
          }
        }}
      >
        <div
          className={cn(
            "flex w-full touch-pan-x",
            count > 1 && (dragging ? "cursor-grabbing" : "cursor-grab"),
            count <= 1 && count > 0 && "cursor-zoom-in",
          )}
          ref={trackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishPointer(event, false)}
          onPointerCancel={(event) => finishPointer(event, true)}
        >
          {count === 0 ? (
            <div className="aspect-square w-full shrink-0 grow-0 basis-full border border-dashed border-border bg-muted" />
          ) : (
            safeImages.map((src, index) => (
              <div
                key={`${index}-${src}`}
                aria-hidden={index !== active}
                className="relative aspect-square w-full shrink-0 grow-0 basis-full overflow-hidden bg-muted"
              >
                <ProductImage
                  src={src}
                  alt={index === 0 ? alt : ""}
                  sizes={GALLERY_SIZES}
                  priority={index === 0}
                  className="pointer-events-none object-cover"
                />
              </div>
            ))
          )}
        </div>
        {count > 1 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
            <div className="pointer-events-auto flex max-w-full flex-wrap justify-center gap-1 rounded-full bg-background/90 px-1.5 py-1 shadow-sm ring-1 ring-border backdrop-blur-sm">
              {safeImages.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={`Foto ${index + 1}`}
                  aria-current={index === active ? "true" : undefined}
                  onClick={() => goTo(index)}
                  className="flex size-6 items-center justify-center"
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full transition-colors",
                      index === active ? "bg-primary" : "bg-muted-foreground/50",
                    )}
                  />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <ImageLightbox
        images={safeImages}
        initialIndex={lightboxIndex}
        alt={alt}
        open={lightboxOpen}
        onClose={() => {
          setLightboxOpen(false)
          goTo(lightboxIndex)
        }}
        onIndexChange={(nextIndex) => {
          setLightboxIndex(nextIndex)
          goTo(nextIndex)
        }}
      />
    </>
  )
}
