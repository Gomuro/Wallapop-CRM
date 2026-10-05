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
  const threshold = width > 0 ? Math.min(width * 0.18, 80) : 48
  let next = active
  if (dx < -threshold || vx < -0.45) next += 1
  else if (dx > threshold || vx > 0.45) next -= 1
  return Math.min(count - 1, Math.max(0, next))
}

export function setSlideTrack(
  track: HTMLElement | null,
  index: number,
  dx: number,
  animate: boolean,
) {
  if (!track) return
  track.style.transition = animate ? SLIDE_EASE : "none"
  track.style.transform = `translate3d(calc(${-index * 100}% + ${dx}px), 0, 0)`
}
