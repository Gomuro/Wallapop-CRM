"use client"

import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
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

export function setSlideTrack(opts: {
  track: HTMLElement | null
  viewport: HTMLElement | null
  index: number
  dx: number
  animate: boolean
}) {
  const { track, viewport, index, dx, animate } = opts
  if (!track) return
  const width = viewport?.clientWidth || track.clientWidth || 0
  track.style.transition = animate ? SLIDE_EASE : "none"
  track.style.transform = `translate3d(${-index * width + dx}px, 0, 0)`
}

export type SwipeCarouselOptions = {
  index: number
  count: number
  enabled?: boolean
  trackRef: RefObject<HTMLElement | null>
  viewportRef: RefObject<HTMLElement | null>
  onIndex: (index: number) => void
  onTap?: (index: number) => void
  onVerticalDismiss?: () => void
}

type DragState = {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  lastT: number
  vx: number
  axis: "undecided" | "x" | "y"
  moved: boolean
}

type ApplySlide = (nextIndex: number, dx: number, animate: boolean) => void

export type SwipeRefs = {
  index: MutableRefObject<number>
  count: MutableRefObject<number>
  enabled: MutableRefObject<boolean>
  onIndex: MutableRefObject<(index: number) => void>
  onTap: MutableRefObject<((index: number) => void) | undefined>
  onVertical: MutableRefObject<(() => void) | undefined>
  dragging: MutableRefObject<boolean>
  drag: MutableRefObject<DragState | null>
  track: RefObject<HTMLElement | null>
  viewport: RefObject<HTMLElement | null>
}

export function observeViewportResize(
  viewportRef: RefObject<HTMLElement | null>,
  dragging: MutableRefObject<boolean>,
  index: MutableRefObject<number>,
  apply: ApplySlide,
) {
  const viewport = viewportRef.current
  if (!viewport || typeof ResizeObserver === "undefined") return
  const observer = new ResizeObserver(() => {
    if (dragging.current) return
    apply(index.current, 0, false)
  })
  observer.observe(viewport)
  return () => observer.disconnect()
}

function useSwipeRefs({
  index,
  count,
  enabled = true,
  trackRef,
  viewportRef,
  onIndex,
  onTap,
  onVerticalDismiss,
}: SwipeCarouselOptions): SwipeRefs {
  const indexRef = useRef(index)
  const countRef = useRef(count)
  const enabledRef = useRef(enabled)
  const onIndexRef = useRef(onIndex)
  const onTapRef = useRef(onTap)
  const onVerticalRef = useRef(onVerticalDismiss)
  const draggingRef = useRef(false)
  const dragRef = useRef<DragState | null>(null)

  useEffect(() => {
    indexRef.current = index
    countRef.current = count
    enabledRef.current = enabled
    onIndexRef.current = onIndex
    onTapRef.current = onTap
    onVerticalRef.current = onVerticalDismiss
  }, [index, count, enabled, onIndex, onTap, onVerticalDismiss])

  return {
    index: indexRef,
    count: countRef,
    enabled: enabledRef,
    onIndex: onIndexRef,
    onTap: onTapRef,
    onVertical: onVerticalRef,
    dragging: draggingRef,
    drag: dragRef,
    track: trackRef,
    viewport: viewportRef,
  }
}

export function handlePointerDown(
  event: PointerEvent<HTMLElement>,
  refs: SwipeRefs,
) {
  if (!refs.enabled.current || refs.count.current === 0 || event.button !== 0) {
    return
  }
  if (event.pointerType === "mouse") event.preventDefault()
  refs.drag.current = {
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

export function handlePointerMove(
  event: PointerEvent<HTMLElement>,
  refs: SwipeRefs,
  apply: ApplySlide,
) {
  const drag = refs.drag.current
  if (!drag || drag.pointerId !== event.pointerId) return

  const dx = event.clientX - drag.startX
  const dy = event.clientY - drag.startY
  if (drag.axis === "undecided" && Math.hypot(dx, dy) > 8) {
    drag.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y"
    drag.moved = true
  }
  if (drag.axis !== "x") return

  event.preventDefault()
  refs.dragging.current = true
  const now = performance.now()
  drag.vx = (event.clientX - drag.lastX) / Math.max(1, now - drag.lastT)
  drag.lastX = event.clientX
  drag.lastY = event.clientY
  drag.lastT = now

  const active = refs.index.current
  const total = refs.count.current
  const resist = (active === 0 && dx > 0) || (active === total - 1 && dx < 0)
  apply(active, rubberbandOffset(dx, resist), false)
}

export function finishTap(
  apply: ApplySlide,
  active: number,
  cancelled: boolean,
  refs: SwipeRefs,
) {
  apply(active, 0, true)
  if (!cancelled) refs.onTap.current?.(active)
}

export function finishNonHorizontal(input: {
  apply: ApplySlide
  active: number
  cancelled: boolean
  drag: DragState
  dx: number
  dy: number
  refs: SwipeRefs
}) {
  const { apply, active, cancelled, drag, dx, dy, refs } = input
  if (
    !cancelled &&
    drag.axis === "y" &&
    refs.onVertical.current &&
    dy > 90 &&
    Math.abs(dy) > Math.abs(dx)
  ) {
    refs.onVertical.current()
    return
  }
  apply(active, 0, true)
}

export function settleHorizontalSwipe(input: {
  apply: ApplySlide
  active: number
  cancelled: boolean
  drag: DragState
  dx: number
  refs: SwipeRefs
}) {
  const { apply, active, cancelled, drag, dx, refs } = input
  if (cancelled && Math.abs(dx) < 24) {
    apply(active, 0, true)
    return
  }
  const next = settleSwipeIndex({
    active,
    count: refs.count.current,
    dx,
    width: refs.viewport.current?.clientWidth ?? 0,
    vx: drag.vx,
  })
  apply(next, 0, true)
  if (next !== active) refs.onIndex.current(next)
}

export function finishPointer(
  event: PointerEvent<HTMLElement>,
  cancelled: boolean,
  refs: SwipeRefs,
  apply: ApplySlide,
) {
  const drag = refs.drag.current
  if (!drag || drag.pointerId !== event.pointerId) return
  refs.drag.current = null
  refs.dragging.current = false
  const dx = drag.lastX - drag.startX
  const dy = drag.lastY - drag.startY
  const active = refs.index.current
  if (!drag.moved) {
    finishTap(apply, active, cancelled, refs)
    return
  }
  if (drag.axis !== "x") {
    finishNonHorizontal({ apply, active, cancelled, drag, dx, dy, refs })
    return
  }
  settleHorizontalSwipe({ apply, active, cancelled, drag, dx, refs })
}

export function useSwipeCarousel(args: SwipeCarouselOptions) {
  const { index, trackRef, viewportRef } = args
  const refs = useSwipeRefs(args)
  const apply = useCallback(
    (nextIndex: number, dx: number, animate: boolean) =>
      setSlideTrack({
        track: trackRef.current,
        viewport: viewportRef.current,
        index: nextIndex,
        dx,
        animate,
      }),
    [trackRef, viewportRef],
  )
  useEffect(() => {
    if (refs.dragging.current) return
    apply(index, 0, true)
  }, [apply, index, refs.dragging])
  useEffect(
    () =>
      observeViewportResize(viewportRef, refs.dragging, refs.index, apply),
    [apply, viewportRef, refs.dragging, refs.index],
  )
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) =>
      handlePointerDown(event, refs),
    onPointerMove: (event: PointerEvent<HTMLElement>) =>
      handlePointerMove(event, refs, apply),
    onPointerUp: (event: PointerEvent<HTMLElement>) =>
      finishPointer(event, false, refs, apply),
    onPointerCancel: (event: PointerEvent<HTMLElement>) =>
      finishPointer(event, true, refs, apply),
  }
}
