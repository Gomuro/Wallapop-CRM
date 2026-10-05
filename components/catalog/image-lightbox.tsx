"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react"
import { createPortal } from "react-dom"
import { XIcon } from "lucide-react"

import {
  rubberbandOffset,
  setSlideTrack,
  settleSwipeIndex,
} from "@/lib/ui/swipe-carousel"
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
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    lastX: number
    lastT: number
    vx: number
    axis: "undecided" | "x" | "y"
    moved: boolean
  } | null>(null)
  const [mounted, setMounted] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [dragging, setDragging] = useState(false)

  const count = images.length

  const goTo = useCallback(
    (index: number, animate = true) => {
      if (count === 0) return
      const next = Math.min(count - 1, Math.max(0, index))
      setCurrentIndex(next)
      setSlideTrack(trackRef.current, next, 0, animate)
      if (next !== currentIndex) onIndexChange?.(next)
    },
    [count, currentIndex, onIndexChange],
  )

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const next = Math.min(Math.max(0, initialIndex), Math.max(0, count - 1))
    setCurrentIndex(next)
    const frame = requestAnimationFrame(() => {
      setSlideTrack(trackRef.current, next, 0, false)
    })
    return () => cancelAnimationFrame(frame)
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
        goTo(currentIndex - 1)
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        goTo(currentIndex + 1)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, currentIndex, goTo, onClose])

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastT: performance.now(),
      vx: 0,
      axis: "undecided",
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
    if (!drag || drag.pointerId !== event.pointerId) return

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (drag.axis === "undecided" && Math.hypot(dx, dy) > 8) {
      drag.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y"
      drag.moved = true
      setDragging(true)
    }
    if (drag.axis !== "x") return

    const now = performance.now()
    drag.vx = (event.clientX - drag.lastX) / Math.max(1, now - drag.lastT)
    drag.lastX = event.clientX
    drag.lastT = now

    const resist =
      (currentIndex === 0 && dx > 0) || (currentIndex === count - 1 && dx < 0)
    setSlideTrack(
      trackRef.current,
      currentIndex,
      rubberbandOffset(dx, resist),
      false,
    )
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY

    if (!cancelled && drag.axis === "y" && dy > 90 && Math.abs(dy) > Math.abs(dx)) {
      onClose()
      return
    }

    if (drag.axis !== "x") {
      setSlideTrack(trackRef.current, currentIndex, 0, true)
      return
    }

    const width = viewportRef.current?.clientWidth ?? 0
    goTo(settleSwipeIndex({ active: currentIndex, count, dx, width, vx: drag.vx }))
  }

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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishPointer(event, false)}
        onPointerCancel={(event) => finishPointer(event, true)}
        className={cn(
          "relative flex flex-1 w-full items-center overflow-hidden",
          dragging ? "cursor-grabbing" : count > 1 ? "cursor-grab" : "cursor-default",
        )}
      >
        <div ref={trackRef} className="flex h-full w-full touch-pan-x">
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
                onClick={() => goTo(idx)}
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
