import { createHash } from "node:crypto"

/** One consumer phone per listing. Every photo in that post shares it. */
const PHONE_PROFILES = [
  {
    label: "iPhone 13",
    make: "Apple",
    model: "iPhone 13",
    software: "17.5.1",
    lensModel: "iPhone 13 back dual wide camera 5.1mm f/1.6",
    focalLength: "5.1",
    focalLength35: "26",
    fNumber: "1.6",
  },
  {
    label: "iPhone 14",
    make: "Apple",
    model: "iPhone 14",
    software: "18.3.2",
    lensModel: "iPhone 14 back dual wide camera 5.7mm f/1.5",
    focalLength: "5.7",
    focalLength35: "26",
    fNumber: "1.5",
  },
  {
    label: "iPhone 15",
    make: "Apple",
    model: "iPhone 15",
    software: "18.5",
    lensModel: "iPhone 15 back dual wide camera 6.86mm f/1.6",
    focalLength: "6.86",
    focalLength35: "26",
    fNumber: "1.6",
  },
  {
    label: "Galaxy S22",
    make: "samsung",
    model: "SM-S901B",
    software: "S901BXXS6CWL1",
    focalLength: "5.4",
    focalLength35: "23",
    fNumber: "1.8",
  },
  {
    label: "Pixel 7",
    make: "Google",
    model: "Pixel 7",
    software: "HDR+ 1.0.640437003zd",
    focalLength: "6.81",
    focalLength35: "25",
    fNumber: "1.85",
  },
] as const

const EXPOSURES = ["1/50", "1/60", "1/80", "1/100", "1/120"] as const
const ISO_BASES = [50, 64, 80, 100, 125, 160] as const
const SIDES = ["left", "right", "top", "bottom"] as const

export type PhoneProfile = (typeof PHONE_PROFILES)[number]
export type CropSide = (typeof SIDES)[number]
export type Crop = { left: number; top: number; right: number; bottom: number }

export type ShootGrade = {
  brightness: number
  contrast: number
  saturation: number
  hue: number
  noise: number
  qscale: number
  crop: Crop
}

export type ShootLook = {
  profile: PhoneProfile
  takenAt: Date
  offset: string
  exposure: string
  isoBase: number
  grade: ShootGrade
}

export type PhotoFrame = {
  storageKey: string
  takenAt: Date
  iso: number
  cropExtra: { side: CropSide; px: number }
  imageUniqueId: string
  documentId: string
  instanceId: string
}

function hashToUint(input: string): number {
  return createHash("sha256").update(input).digest().readUInt32BE(0)
}

function pick<T>(listingId: string, salt: string, items: readonly T[]): T {
  return items[hashToUint(`${listingId}:${salt}`) % items.length]!
}

function unit(listingId: string, salt: string): number {
  return (hashToUint(`${listingId}:${salt}`) % 10_000) / 10_000
}

function range(listingId: string, salt: string, min: number, max: number): number {
  return min + (max - min) * unit(listingId, salt)
}

function hex(input: string, length: number): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length)
}

function uuidFrom(input: string): string {
  const raw = hex(input, 32)
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-a${raw.slice(17, 20)}-${raw.slice(20, 32)}`
}

/** Approximate Spain civil offset: +02:00 from April through October. */
export function spainOffset(date: Date): string {
  const month = date.getUTCMonth()
  if (month >= 3 && month <= 9) return "+02:00"
  return "+01:00"
}

export function formatExifDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return [
    `${date.getUTCFullYear()}:${pad(date.getUTCMonth() + 1)}:${pad(date.getUTCDate())}`,
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
  ].join(" ")
}

function takenAtFromListing(listingId: string): Date {
  const start = Date.UTC(2024, 2, 1)
  const end = Date.UTC(2026, 8, 1)
  const spanDays = Math.floor((end - start) / 86_400_000)
  const day = hashToUint(`${listingId}:day`) % spanDays
  const hour = 10 + (hashToUint(`${listingId}:hour`) % 9)
  const minute = hashToUint(`${listingId}:min`) % 60
  const second = hashToUint(`${listingId}:sec`) % 60
  return new Date(start + day * 86_400_000 + (hour * 3600 + minute * 60 + second) * 1000)
}

/** Seconds from the first frame. Each next shot is 2–4 seconds later. */
export function frameOffsetSeconds(listingId: string, index: number): number {
  let total = 0
  for (let i = 1; i <= index; i++) {
    total += 2 + (hashToUint(`${listingId}:gap:${i}`) % 3)
  }
  return total
}

function sharedCrop(listingId: string): Crop {
  const horizontal = 4 + (hashToUint(`${listingId}:insetH`) % 9)
  const vertical = 4 + (hashToUint(`${listingId}:insetV`) % 9)
  const left = hashToUint(`${listingId}:left`) % (horizontal + 1)
  const top = hashToUint(`${listingId}:top`) % (vertical + 1)
  return {
    left,
    top,
    right: horizontal - left,
    bottom: vertical - top,
  }
}

export function clampCrop(
  crop: Crop,
  size: { width: number; height: number },
): Crop {
  if (
    size.width - crop.left - crop.right < 8 ||
    size.height - crop.top - crop.bottom < 8
  ) {
    return { left: 0, top: 0, right: 0, bottom: 0 }
  }
  return crop
}

export function cropForFrame(
  look: ShootLook,
  frame: PhotoFrame,
  size: { width: number; height: number },
): Crop {
  const next = { ...look.grade.crop }
  next[frame.cropExtra.side] += frame.cropExtra.px
  return clampCrop(next, size)
}

function frameFor(
  listingId: string,
  look: ShootLook,
  storageKey: string,
  index: number,
): PhotoFrame {
  const bump = hashToUint(`${listingId}:${storageKey}:iso`) % 2 === 0 ? 0 : 25
  return {
    storageKey,
    takenAt: new Date(look.takenAt.getTime() + frameOffsetSeconds(listingId, index) * 1000),
    iso: Math.min(200, look.isoBase + bump),
    cropExtra: {
      side: pick(listingId, `${storageKey}:side`, SIDES),
      px: hashToUint(`${listingId}:${storageKey}:px`) % 3,
    },
    imageUniqueId: hex(`${listingId}:${storageKey}:uniq`, 32),
    documentId: `xmp.did:${uuidFrom(`${listingId}:${storageKey}:doc`)}`,
    instanceId: `xmp.did:${uuidFrom(`${listingId}:${storageKey}:inst`)}`,
  }
}

export function planPublishPhotos(
  listingId: string,
  storageKeys: string[],
): { look: ShootLook; frames: PhotoFrame[] } {
  const takenAt = takenAtFromListing(listingId)
  const look: ShootLook = {
    profile: pick(listingId, "phone", PHONE_PROFILES),
    takenAt,
    offset: spainOffset(takenAt),
    exposure: pick(listingId, "exposure", EXPOSURES),
    isoBase: pick(listingId, "iso", ISO_BASES),
    grade: {
      brightness: range(listingId, "bright", -0.01, 0.01),
      contrast: range(listingId, "contrast", 0.98, 1.02),
      saturation: range(listingId, "sat", 0.98, 1.02),
      hue: range(listingId, "hue", -1, 1),
      noise: 1 + (hashToUint(`${listingId}:noise`) % 2),
      qscale: hashToUint(`${listingId}:q`) % 2 === 0 ? 2 : 3,
      crop: sharedCrop(listingId),
    },
  }
  return {
    look,
    frames: storageKeys.map((storageKey, index) => frameFor(listingId, look, storageKey, index)),
  }
}
