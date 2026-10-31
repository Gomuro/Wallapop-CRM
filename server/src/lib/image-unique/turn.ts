import type { Crop, FrameTurn } from "./shoot"

type Size = { width: number; height: number }

/** What the duplicate geometry did to one photo, in source pixels and degrees. */
export type TurnResult = { degrees: number; crop: Crop; filters: string[] }

const TURN_STEP_DEGREES = 0.25

/** Share of each side the turn alone eats so that no empty corner shows. */
export function turnTrim(size: Size, degrees: number): number {
  const angle = (Math.abs(degrees) * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const scale = Math.min(
    size.width / (size.width * cos + size.height * sin),
    size.height / (size.width * sin + size.height * cos),
  )
  return (1 - scale) / 2
}

/** The planned turn, or a smaller one when a very long frame cannot afford it. */
export function fittedTurn(size: Size, turn: FrameTurn): number {
  const sign = Math.sign(turn.degrees)
  for (let abs = Math.abs(turn.degrees); abs > 0; abs -= TURN_STEP_DEGREES) {
    if (turnTrim(size, abs) <= turn.trim) return sign * abs
  }
  return 0
}

/** Centred crop of `trim` per side, rounded outwards so the corners stay inside. */
export function centredCrop(size: Size, trim: number): Crop {
  const x = Math.ceil(size.width * trim)
  const y = Math.ceil(size.height * trim)
  return { left: x, right: x, top: y, bottom: y }
}

/** ffmpeg steps for the duplicate: turn around the centre, then cut the corners away. */
export function turnFilters(size: Size, turn: FrameTurn): TurnResult {
  const degrees = fittedTurn(size, turn)
  const crop = centredCrop(size, turn.trim)
  const width = size.width - crop.left - crop.right
  const height = size.height - crop.top - crop.bottom
  const radians = ((degrees * Math.PI) / 180).toFixed(6)
  return {
    degrees,
    crop,
    filters: [
      `rotate=${radians}:ow=iw:oh=ih:fillcolor=white`,
      `crop=${width}:${height}:${crop.left}:${crop.top}`,
    ],
  }
}
