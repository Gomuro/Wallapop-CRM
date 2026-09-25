"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

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
  const count = images.length

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

  return (
    <div
      className="group relative min-w-0 overflow-hidden bg-muted lg:rounded-xl"
      tabIndex={count > 1 ? 0 : undefined}
      role={count > 1 ? "region" : undefined}
      aria-roledescription={count > 1 ? "carousel" : undefined}
      aria-label={count > 1 ? `${alt}. Photo ${active + 1} of ${count}` : alt}
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
          images.map((src, index) => (
            <div
              key={`${index}-${src}`}
              className="relative aspect-square min-w-0 flex-[0_0_100%] snap-center overflow-hidden bg-muted"
            >
              <ProductImage
                src={src}
                alt={index === 0 ? alt : ""}
                sizes={GALLERY_SIZES}
                priority={index === 0}
                className="object-cover"
              />
            </div>
          ))
        )}
      </div>
      {count > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            disabled={active === 0}
            onClick={() => scrollToIndex(active - 1)}
            className="absolute top-1/2 left-3 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/95 text-foreground shadow-sm ring-1 ring-border transition-opacity hover:bg-background focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 md:inline-flex md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            disabled={active === count - 1}
            onClick={() => scrollToIndex(active + 1)}
            className="absolute top-1/2 right-3 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/95 text-foreground shadow-sm ring-1 ring-border transition-opacity hover:bg-background focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 md:inline-flex md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
          >
            <ChevronRightIcon className="size-5" />
          </button>
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
            <div className="pointer-events-auto flex max-w-full flex-wrap justify-center gap-1 rounded-full bg-background/90 px-1.5 py-1 shadow-sm ring-1 ring-border backdrop-blur-sm">
              {images.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={`Photo ${index + 1}`}
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
  )
}
