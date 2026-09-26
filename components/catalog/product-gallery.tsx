"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { ImageLightbox } from "@/components/catalog/image-lightbox"
import { GALLERY_SIZES, ProductImage } from "@/components/catalog/product-image"
import { cn } from "@/lib/utils"

export function ProductGallery({
  images = [],
  alt,
}: {
  images?: string[]
  alt: string
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const [active, setActive] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)

  const safeImages = Array.isArray(images)
    ? images.filter(
        (src) =>
          typeof src === "string" &&
          src.length > 0 &&
          !(src.startsWith("data:") && src.length > 8_000),
      )
    : []
  const count = safeImages.length

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  function scrollToIndex(index: number) {
    const el = scrollerRef.current
    if (!el || count === 0) return
    const next = Math.min(count - 1, Math.max(0, index))
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" })
  }

  function handleScroll() {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const el = scrollerRef.current
      if (!el || count === 0) return
      const width = el.clientWidth
      if (width === 0) return
      const next = Math.round(el.scrollLeft / width)
      setActive(Math.min(count - 1, Math.max(0, next)))
    })
  }

  function openLightbox(index: number) {
    setLightboxIndex(index)
    setLightboxOpen(true)
  }

  return (
    <>
      <div
        className="group relative min-w-0 overflow-hidden bg-muted lg:rounded-xl"
        tabIndex={count > 1 ? 0 : undefined}
        role={count > 1 ? "region" : undefined}
        aria-roledescription={count > 1 ? "carousel" : undefined}
        aria-label={count > 1 ? `${alt}. Foto ${active + 1} de ${count}` : alt}
        onKeyDown={(event) => {
          if (count < 2) return
          if (event.key === "ArrowRight") {
            event.preventDefault()
            scrollToIndex(active + 1)
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault()
            scrollToIndex(active - 1)
          }
        }}
      >
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="flex min-w-0 snap-x snap-mandatory overflow-x-auto scroll-smooth overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {count === 0 ? (
            <div className="aspect-square w-full shrink-0 border border-dashed border-border bg-muted" />
          ) : (
            safeImages.map((src, index) => (
              <div
                key={`${index}-${src}`}
                role="button"
                tabIndex={0}
                aria-label={`Ver foto ${index + 1} de ${count} en pantalla completa`}
                onPointerDown={(event) => {
                  pointerStartRef.current = { x: event.clientX, y: event.clientY }
                }}
                onClick={(event) => {
                  if (pointerStartRef.current) {
                    const dx = Math.abs(event.clientX - pointerStartRef.current.x)
                    const dy = Math.abs(event.clientY - pointerStartRef.current.y)
                    if (Math.hypot(dx, dy) > 10) return
                  }
                  openLightbox(index)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    openLightbox(index)
                  }
                }}
                className="relative aspect-square min-w-0 flex-[0_0_100%] snap-center cursor-zoom-in overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <ProductImage
                  src={src}
                  alt={index === 0 ? alt : ""}
                  sizes={GALLERY_SIZES}
                  priority={index === 0}
                  className="object-cover transition-transform duration-200 hover:scale-[1.01]"
                />
              </div>
            ))
          )}
        </div>
        {count > 1 ? (
          <>
            <button
              type="button"
              aria-label="Foto anterior"
              disabled={active === 0}
              onClick={() => scrollToIndex(active - 1)}
              className="absolute top-1/2 left-3 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/95 text-foreground shadow-sm ring-1 ring-border transition-opacity hover:bg-background focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 md:inline-flex md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
            >
              <ChevronLeftIcon className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Foto siguiente"
              disabled={active === count - 1}
              onClick={() => scrollToIndex(active + 1)}
              className="absolute top-1/2 right-3 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/95 text-foreground shadow-sm ring-1 ring-border transition-opacity hover:bg-background focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 md:inline-flex md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
            >
              <ChevronRightIcon className="size-5" />
            </button>
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
              <div className="pointer-events-auto flex max-w-full flex-wrap justify-center gap-1 rounded-full bg-background/90 px-1.5 py-1 shadow-sm ring-1 ring-border backdrop-blur-sm">
                {safeImages.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    aria-label={`Foto ${index + 1}`}
                    aria-current={index === active ? "true" : undefined}
                    onClick={() => scrollToIndex(index)}
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
          </>
        ) : null}
      </div>

      <ImageLightbox
        images={safeImages}
        initialIndex={lightboxIndex}
        alt={alt}
        open={lightboxOpen}
        onClose={() => {
          setLightboxOpen(false)
          scrollToIndex(lightboxIndex)
        }}
        onIndexChange={(nextIndex) => {
          setLightboxIndex(nextIndex)
          scrollToIndex(nextIndex)
        }}
      />
    </>
  )
}
