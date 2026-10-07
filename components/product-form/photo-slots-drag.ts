import type {
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react"

const DRAG_THRESHOLD_PX = 8
const PRESS_DELAY_MS = 150

type SlotImage = {
  url: string
  id?: string
  file?: File
}

export type DragSession = {
  pointerId: number
  from: number
  startX: number
  startY: number
  ready: boolean
  active: boolean
  timer: number
}

export type PhotoSlotDragRefs = {
  sessionRef: MutableRefObject<DragSession | null>
  overIndexRef: MutableRefObject<number | null>
  gridRef: RefObject<HTMLDivElement | null>
}

function reorderSlots(images: SlotImage[], from: number, to: number): SlotImage[] {
  if (from === to || from < 0 || to < 0 || from >= images.length) return images
  const next = [...images]
  const [moved] = next.splice(from, 1)
  if (!moved) return images
  next.splice(Math.min(to, next.length), 0, moved)
  return next
}

function slotIndexFromPoint(
  gridRef: RefObject<HTMLDivElement | null>,
  x: number,
  y: number,
): number | null {
  const grid = gridRef.current
  if (!grid) return null
  const hit = document.elementFromPoint(x, y)
  const slot = hit?.closest("[data-photo-slot]")
  if (!slot || !grid.contains(slot)) return null
  const index = Number(slot.getAttribute("data-photo-slot"))
  return Number.isInteger(index) ? index : null
}

function photoSlotDropTarget(index: number | null, imageCount: number): number | null {
  if (index === null) return null
  if (index < imageCount) return index
  return Math.min(index, imageCount)
}

function clearPhotoSlotDrag(
  refs: PhotoSlotDragRefs,
  setDragIndex: (value: number | null) => void,
  setOverIndex: (value: number | null) => void,
) {
  if (refs.sessionRef.current?.timer) {
    window.clearTimeout(refs.sessionRef.current.timer)
  }
  refs.sessionRef.current = null
  refs.overIndexRef.current = null
  setDragIndex(null)
  setOverIndex(null)
}

export function startPhotoSlotDrag(
  event: ReactPointerEvent<HTMLDivElement>,
  index: number,
  uploading: boolean,
  sessionRef: MutableRefObject<DragSession | null>,
) {
  if (uploading || event.button !== 0) return
  const pointerId = event.pointerId
  const isTouch = event.pointerType === "touch"
  const timer = isTouch
    ? window.setTimeout(() => {
        const session = sessionRef.current
        if (!session || session.pointerId !== pointerId) return
        session.ready = true
      }, PRESS_DELAY_MS)
    : 0
  sessionRef.current = {
    pointerId,
    from: index,
    startX: event.clientX,
    startY: event.clientY,
    ready: !isTouch,
    active: false,
    timer,
  }
}

export function movePhotoSlotDrag(
  event: ReactPointerEvent<HTMLDivElement>,
  refs: PhotoSlotDragRefs,
  setDragIndex: (value: number | null) => void,
  setOverIndex: (value: number | null) => void,
) {
  const session = refs.sessionRef.current
  if (!session || session.pointerId !== event.pointerId) return
  const distance = Math.hypot(
    event.clientX - session.startX,
    event.clientY - session.startY,
  )

  if (!session.active) {
    if (!session.ready) {
      if (distance > DRAG_THRESHOLD_PX) {
        clearPhotoSlotDrag(refs, setDragIndex, setOverIndex)
      }
      return
    }
    if (distance < DRAG_THRESHOLD_PX) return
    session.active = true
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragIndex(session.from)
    refs.overIndexRef.current = session.from
    setOverIndex(session.from)
  }

  event.preventDefault()
  const hover = slotIndexFromPoint(refs.gridRef, event.clientX, event.clientY)
  if (hover !== refs.overIndexRef.current) {
    refs.overIndexRef.current = hover
    setOverIndex(hover)
  }
}

export function finishPhotoSlotDrag(
  event: ReactPointerEvent<HTMLDivElement>,
  ctx: PhotoSlotDragRefs & {
    safeImages: SlotImage[]
    setDragIndex: (value: number | null) => void
    setOverIndex: (value: number | null) => void
    commit: (next: SlotImage[]) => void
    persistOrder: (next: SlotImage[]) => void
  },
) {
  const session = ctx.sessionRef.current
  if (!session || session.pointerId !== event.pointerId) return
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
  if (!session.active) {
    clearPhotoSlotDrag(ctx, ctx.setDragIndex, ctx.setOverIndex)
    return
  }
  const from = session.from
  const to = photoSlotDropTarget(ctx.overIndexRef.current, ctx.safeImages.length)
  clearPhotoSlotDrag(ctx, ctx.setDragIndex, ctx.setOverIndex)
  if (to === null || from === to) return
  if (from < 0 || from >= ctx.safeImages.length) return
  const next = reorderSlots(ctx.safeImages, from, to)
  ctx.commit(next)
  ctx.persistOrder(next)
}
