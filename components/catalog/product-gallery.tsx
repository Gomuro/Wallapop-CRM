"use client"

import { useState, useRef } from "react"

import { ImageLightbox } from "@/components/catalog/image-lightbox"
import { GALLERY_SIZES, ProductImage } from "@/components/catalog/product-image"
import { useSwipeCarousel } from "@/lib/ui/swipe-carousel"
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
  const [active, setActive] = useState(0)
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

  const swipe = useSwipeCarousel({
    index: active,
    count,
    trackRef,
    viewportRef,
    onIndex: setActive,
    onTap: (index) => {
      setLightboxIndex(index)
      setLightboxOpen(true)
    },
  })

  return (
    <>
      <div
        ref={viewportRef}
        className="group relative min-w-0 overflow-hidden overscroll-x-none bg-muted select-none touch-none lg:rounded-xl"
        tabIndex={count > 1 ? 0 : undefined}
        role={count > 1 ? "region" : undefined}
        aria-roledescription={count > 1 ? "carousel" : undefined}
        aria-label={count > 1 ? `${alt}. Foto ${active + 1} de ${count}` : alt}
        onKeyDown={(event) => {
          if (count < 2) return
          if (event.key === "ArrowRight") {
            event.preventDefault()
            setActive((current) => Math.min(count - 1, current + 1))
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault()
            setActive((current) => Math.max(0, current - 1))
          }
        }}
        onPointerDown={swipe.onPointerDown}
        onPointerMove={swipe.onPointerMove}
        onPointerUp={swipe.onPointerUp}
        onPointerCancel={swipe.onPointerCancel}
      >
        <div
          ref={trackRef}
          className={cn(
            "flex w-full",
            count > 1 && "cursor-grab active:cursor-grabbing",
            count === 1 && "cursor-zoom-in",
          )}
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
                  onClick={() => setActive(index)}
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
          setActive(lightboxIndex)
        }}
        onIndexChange={(nextIndex) => {
          setLightboxIndex(nextIndex)
          setActive(nextIndex)
        }}
      />
    </>
  )
}
