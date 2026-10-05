"use client"

import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent,
  type RefObject,
} from "react"

export const SLIDE_EASE = "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)"

export function rubberbandOffset(dx: number, resist: boolean): number {
  if (!resist) return dx
  return dx * 0.32
}

export function settleSwipeIndex({
  active,
  count,
  dx,
  width,
  vx,
}: {
  active: number
  count: number
  dx: number
  width: number
  vx: number
}): number {
  if (count <= 1) return 0
  const threshold = width > 0 ? Math.min(width * 0.15, 56) : 40
  let next = active
  if (dx < -threshold || vx < -0.35) next += 1
  else if (dx > threshold || vx > 0.35) next -= 1
  return Math.min(count - 1, Math.max(0, next))
}

export function setSlideTrack(
  track: HTMLElement | null,
  viewport: HTMLElement | null,
  index: number,
  dx: number,
  animate: boolean,
) {
  if (!track) return
  const width = viewport?.clientWidth || track.clientWidth || 0
  track.style.transition = animate ? SLIDE_EASE : "none"
  track.style.transform = `translate3d(${-index * width + dx}px, 0, 0)`
}

export function useSwipeCarousel({
  index,
  count,
  enabled = true,
  trackRef,
  viewportRef,
  onIndex,
  onTap,
  onVerticalDismiss,
}: {
  index: number
  count: number
  enabled?: boolean
  trackRef: RefObject<HTMLElement | null>
  viewportRef: RefObject<HTMLElement | null>
  onIndex: (index: number) => void
  onTap?: (index: number) => void
  onVerticalDismiss?: () => void
}) {
  const indexRef = useRef(index)
  const countRef = useRef(count)
  const enabledRef = useRef(enabled)
  const onIndexRef = useRef(onIndex)
  const onTapRef = useRef(onTap)
  const onVerticalRef = useRef(onVerticalDismiss)
  const draggingRef = useRef(false)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    lastT: number
    vx: number
    axis: "undecided" | "x" | "y"
    moved: boolean
  } | null>(null)

  indexRef.current = index
  countRef.current = count
  enabledRef.current = enabled
  onIndexRef.current = onIndex
  onTapRef.current = onTap
  onVerticalRef.current = onVerticalDismiss

  const apply = useCallback(
    (nextIndex: number, dx: number, animate: boolean) => {
      setSlideTrack(
        trackRef.current,
        viewportRef.current,
        nextIndex,
        dx,
        animate,
      )
    },
    [trackRef, viewportRef],
  )

  useEffect(() => {
    if (draggingRef.current) return
    apply(index, 0, true)
  }, [apply, index])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      if (draggingRef.current) return
      apply(indexRef.current, 0, false)
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [apply, viewportRef])

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (!enabledRef.current || countRef.current === 0 || event.button !== 0) {
      return
    }
    if (event.pointerType === "mouse") event.preventDefault()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
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

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (drag.axis === "undecided" && Math.hypot(dx, dy) > 8) {
      drag.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y"
      drag.moved = true
    }
    if (drag.axis !== "x") return

    event.preventDefault()
    draggingRef.current = true
    const now = performance.now()
    drag.vx = (event.clientX - drag.lastX) / Math.max(1, now - drag.lastT)
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    drag.lastT = now

    const active = indexRef.current
    const total = countRef.current
    const resist = (active === 0 && dx > 0) || (active === total - 1 && dx < 0)
    apply(active, rubberbandOffset(dx, resist), false)
  }

  function finishPointer(event: PointerEvent<HTMLElement>, cancelled: boolean) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    draggingRef.current = false

    const dx = drag.lastX - drag.startX
    const dy = drag.lastY - drag.startY
    const active = indexRef.current

    if (!drag.moved) {
      apply(active, 0, true)
      if (!cancelled) onTapRef.current?.(active)
      return
    }

    if (drag.axis !== "x") {
      if (
        !cancelled &&
        drag.axis === "y" &&
        onVerticalRef.current &&
        dy > 90 &&
        Math.abs(dy) > Math.abs(dx)
      ) {
        onVerticalRef.current()
        return
      }
      apply(active, 0, true)
      return
    }

    if (cancelled && Math.abs(dx) < 24) {
      apply(active, 0, true)
      return
    }

    const width = viewportRef.current?.clientWidth ?? 0
    const next = settleSwipeIndex({
      active,
      count: countRef.current,
      dx,
      width,
      vx: drag.vx,
    })
    apply(next, 0, true)
    if (next !== active) onIndexRef.current(next)
  }

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: (event: PointerEvent<HTMLElement>) =>
      finishPointer(event, false),
    onPointerCancel: (event: PointerEvent<HTMLElement>) =>
      finishPointer(event, true),
  }
}
