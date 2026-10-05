"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { XIcon } from "lucide-react"

import { useSwipeCarousel } from "@/lib/ui/swipe-carousel"
import { cn } from "@/lib/utils"

export function ImageLightbox({
  images,
  initialIndex = 0,
  alt,
  open,
  onClose,
  onIndexChange,
}: {
  images: string[]
  initialIndex?: number
  alt: string
  open: boolean
  onClose: () => void
  onIndexChange?: (index: number) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const onIndexChangeRef = useRef(onIndexChange)
  const [mounted, setMounted] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(initialIndex)

  const count = images.length
  onIndexChangeRef.current = onIndexChange

  const swipe = useSwipeCarousel({
    index: currentIndex,
    count,
    enabled: open && count > 0,
    trackRef,
    viewportRef,
    onIndex: (next) => {
      setCurrentIndex(next)
      onIndexChangeRef.current?.(next)
    },
    onVerticalDismiss: onClose,
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    setCurrentIndex(Math.min(Math.max(0, initialIndex), Math.max(0, count - 1)))
    // Sync only when opening so parent index updates do not cancel the slide.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialIndex/count read on open
  }, [open])

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      } else if (event.key === "ArrowLeft") {
        event.preventDefault()
        setCurrentIndex((current) => {
          const next = Math.max(0, current - 1)
          if (next !== current) onIndexChangeRef.current?.(next)
          return next
        })
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        setCurrentIndex((current) => {
          const next = Math.min(count - 1, current + 1)
          if (next !== current) onIndexChangeRef.current?.(next)
          return next
        })
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, count, onClose])

  if (!mounted || !open || count === 0) return null

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vista de imagen a pantalla completa"
      className="fixed inset-0 z-50 flex flex-col justify-between bg-black/95 text-white select-none backdrop-blur-md animate-in fade-in-0 duration-150"
    >
      <header className="relative z-10 flex w-full items-center justify-between px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          {count > 1 ? (
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium tracking-wide text-white/90 backdrop-blur-xs">
              {currentIndex + 1} / {count}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar vista completa"
          className="flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 active:scale-95 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          <XIcon className="size-6" />
        </button>
      </header>

      <div
        ref={viewportRef}
        className={cn(
          "relative flex flex-1 w-full items-center overflow-hidden overscroll-none touch-none",
          count > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        )}
        onPointerDown={swipe.onPointerDown}
        onPointerMove={swipe.onPointerMove}
        onPointerUp={swipe.onPointerUp}
        onPointerCancel={swipe.onPointerCancel}
      >
        <div ref={trackRef} className="flex h-full w-full">
          {images.map((src, index) => (
            <div
              key={`${index}-${src}`}
              className="flex h-full w-full shrink-0 grow-0 basis-full items-center justify-center p-2 sm:p-6"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- responsive fullscreen contain inside modal */}
              <img
                src={src}
                alt={index === currentIndex ? `${alt} - Foto ${index + 1}` : ""}
                className="pointer-events-none max-h-[82vh] max-w-full select-none object-contain shadow-2xl"
                draggable={false}
              />
            </div>
          ))}
        </div>
      </div>

      <footer className="relative z-10 flex w-full items-center justify-center px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {count > 1 ? (
          <div className="flex max-w-full flex-wrap justify-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 ring-1 ring-white/10 backdrop-blur-sm">
            {images.map((_, idx) => (
              <button
                key={idx}
                type="button"
                aria-label={`Ver foto ${idx + 1}`}
                aria-current={idx === currentIndex ? "true" : undefined}
                onClick={() => {
                  setCurrentIndex(idx)
                  onIndexChangeRef.current?.(idx)
                }}
                className="flex size-5 items-center justify-center"
              >
                <span
                  className={cn(
                    "rounded-full transition-all duration-200",
                    idx === currentIndex
                      ? "h-2 w-4 bg-white"
                      : "size-2 bg-white/40 hover:bg-white/60",
                  )}
                />
              </button>
            ))}
          </div>
        ) : null}
      </footer>
    </div>
  )

  return createPortal(content, document.body)
}
