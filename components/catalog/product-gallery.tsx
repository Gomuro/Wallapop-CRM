"use client"

import { useRef, useState } from "react"

import { cn } from "@/lib/utils"

export function ProductGallery({
  images = [],
  alt,
}: {
  images?: string[]
  alt: string
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  function handleScroll() {
    const el = scrollerRef.current
    if (!el || images.length === 0) return
    const width = el.clientWidth
    if (width === 0) return
    const next = Math.round(el.scrollLeft / width)
    setActive(Math.min(images.length - 1, Math.max(0, next)))
  }

  return (
    <div className="relative min-w-0 overflow-hidden">
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex min-w-0 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.length === 0 ? (
          <div className="aspect-square w-full shrink-0 border border-dashed border-muted-foreground/30" />
        ) : (
          images.map((src, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${index}-${src}`}
              src={src}
              alt={index === 0 ? alt : ""}
              className="aspect-square w-full shrink-0 snap-center object-cover"
              draggable={false}
            />
          ))
        )}
      </div>
      {images.length > 1 ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center"
          aria-hidden="true"
        >
          <div className="flex gap-1.5 rounded-full bg-background/80 px-2 py-1 shadow-sm backdrop-blur-sm">
            {images.map((_, index) => (
              <span
                key={index}
                className={cn(
                  "size-1.5 rounded-full",
                  index === active
                    ? "bg-primary"
                    : "bg-muted-foreground/50",
                )}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
