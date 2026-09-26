"use client"

import { useEffect, useRef, useState, type TouchEvent } from "react"
import { createPortal } from "react-dom"
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react"

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
  const [mounted, setMounted] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const touchDeltaRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const count = images.length

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (open) {
      setCurrentIndex(Math.min(Math.max(0, initialIndex), Math.max(0, count - 1)))
    }
  }, [open, initialIndex, count])

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
        goTo(currentIndex - 1)
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        goTo(currentIndex + 1)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, currentIndex, count, onClose])

  function goTo(index: number) {
    if (count === 0) return
    const next = Math.min(count - 1, Math.max(0, index))
    setCurrentIndex(next)
    onIndexChange?.(next)
  }

  function handleTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
    touchDeltaRef.current = { x: 0, y: 0 }
  }

  function handleTouchMove(event: TouchEvent) {
    if (!touchStartRef.current || event.touches.length !== 1) return
    const touch = event.touches[0]
    touchDeltaRef.current = {
      x: touch.clientX - touchStartRef.current.x,
      y: touch.clientY - touchStartRef.current.y,
    }
  }

  function handleTouchEnd() {
    if (!touchStartRef.current) return
    const { x, y } = touchDeltaRef.current
    touchStartRef.current = null
    touchDeltaRef.current = { x: 0, y: 0 }

    const absX = Math.abs(x)
    const absY = Math.abs(y)

    // Horizontal swipe navigation
    if (absX > 40 && absX > absY) {
      if (x < 0) {
        goTo(currentIndex + 1)
      } else {
        goTo(currentIndex - 1)
      }
      return
    }

    // Vertical swipe down to dismiss
    if (y > 90 && absY > absX) {
      onClose()
    }
  }

  if (!mounted || !open || count === 0) return null

  const currentSrc = images[currentIndex]

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vista de imagen a pantalla completa"
      className="fixed inset-0 z-50 flex flex-col justify-between bg-black/95 text-white select-none backdrop-blur-md animate-in fade-in-0 duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.backdrop === "true") {
          onClose()
        }
      }}
    >
      {/* Top bar with counter and close button */}
      <header
        data-backdrop="true"
        className="relative z-10 flex w-full items-center justify-between px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
      >
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

      {/* Main image container */}
      <div
        data-backdrop="true"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="relative flex flex-1 w-full items-center justify-center overflow-hidden p-2 sm:p-6"
      >
        {currentSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- responsive fullscreen contain inside modal
          <img
            src={currentSrc}
            alt={`${alt} - Foto ${currentIndex + 1}`}
            className="max-h-[82vh] max-w-full select-none object-contain shadow-2xl transition-transform duration-150"
            draggable={false}
          />
        ) : null}

        {/* Previous button */}
        {count > 1 ? (
          <button
            type="button"
            aria-label="Foto anterior"
            disabled={currentIndex === 0}
            onClick={(e) => {
              e.stopPropagation()
              goTo(currentIndex - 1)
            }}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex size-11 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm ring-1 ring-white/15 transition-opacity hover:bg-black/60 active:scale-95 disabled:pointer-events-none disabled:opacity-20 focus-visible:ring-2 focus-visible:ring-white"
          >
            <ChevronLeftIcon className="size-6" />
          </button>
        ) : null}

        {/* Next button */}
        {count > 1 ? (
          <button
            type="button"
            aria-label="Foto siguiente"
            disabled={currentIndex === count - 1}
            onClick={(e) => {
              e.stopPropagation()
              goTo(currentIndex + 1)
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex size-11 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm ring-1 ring-white/15 transition-opacity hover:bg-black/60 active:scale-95 disabled:pointer-events-none disabled:opacity-20 focus-visible:ring-2 focus-visible:ring-white"
          >
            <ChevronRightIcon className="size-6" />
          </button>
        ) : null}
      </div>

      {/* Footer with dot indicators */}
      <footer
        data-backdrop="true"
        className="relative z-10 flex w-full items-center justify-center px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {count > 1 ? (
          <div className="flex max-w-full flex-wrap justify-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 ring-1 ring-white/10 backdrop-blur-sm">
            {images.map((_, idx) => (
              <button
                key={idx}
                type="button"
                aria-label={`Ver foto ${idx + 1}`}
                aria-current={idx === currentIndex ? "true" : undefined}
                onClick={(e) => {
                  e.stopPropagation()
                  goTo(idx)
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
