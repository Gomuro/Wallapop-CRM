import { z } from "zod"

import {
  CHROME_PROXY_PARSE_ERROR,
  parseChromeProxy,
} from "../accounts/chrome-proxy"

export const accountStatusSchema = z.enum(["ACTIVE", "INACTIVE"])

export const accountCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  status: accountStatusSchema.default("ACTIVE"),
  isDefault: z.boolean().default(false),
  city: z.string().trim().max(100).nullable().optional(),
  postalCode: z.string().trim().max(16).nullable().optional(),
})

export const accountUpdateSchema = accountCreateSchema.partial()

export const wallapopConnectionStatusSchema = z.enum([
  "DISCONNECTED",
  "AUTHENTICATING",
  "ACTIVE",
])

const wallapopProxyField = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((value) => {
    if (value == null) return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  })
  .refine((value) => value == null || parseChromeProxy(value) != null, {
    message: CHROME_PROXY_PARSE_ERROR,
  })

export const wallapopConnectSchema = z.object({
  accountId: z.string().trim().min(1).optional(),
  email: z.string().trim().email("Introduce un email válido.").max(254),
  password: z.string().min(1, "Introduce la contraseña.").max(200),
  proxy: wallapopProxyField,
})

/** Set Chrome proxy without Wallapop login. Same profile, cookies stay. */
export const wallapopProxySchema = z.object({
  accountId: z.string().trim().min(1).optional(),
  proxy: wallapopProxyField,
})

export const wallapop2faSchema = z.object({
  accountId: z.string().trim().min(1).optional(),
  code: z
    .string()
    .trim()
    .min(4, "Introduce el código 2FA.")
    .max(8, "El código 2FA no es válido.")
    .regex(/^[A-Za-z0-9]+$/, "El código 2FA no es válido."),
})

export const AUTOPOST_INTERVAL_UNITS = [
  "seconds",
  "minutes",
  "hours",
  "days",
] as const

export type AutopostIntervalUnit = (typeof AUTOPOST_INTERVAL_UNITS)[number]

export const AUTOPOST_INTERVAL_UNIT_MS: Record<AutopostIntervalUnit, number> = {
  seconds: 1000,
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
}

/** Inclusive bounds for UI / PATCH (1 minute … 7 days). */
export const AUTOPOST_INTERVAL_MS_MIN = 60 * 1000
export const AUTOPOST_INTERVAL_MS_MAX = 7 * AUTOPOST_INTERVAL_UNIT_MS.days

export const AUTOPOST_INTERVAL_RANGE_MESSAGE =
  "El intervalo debe estar entre 1 minuto y 7 días."

export function autopostIntervalToMs(
  value: number,
  unit: AutopostIntervalUnit,
): number {
  return value * AUTOPOST_INTERVAL_UNIT_MS[unit]
}

/** Prefer the coarsest unit that divides `ms` evenly (15 min, not 900 s). */
export function msToAutopostIntervalInput(ms: number): {
  value: number
  unit: AutopostIntervalUnit
} {
  const units: AutopostIntervalUnit[] = ["days", "hours", "minutes", "seconds"]
  for (const unit of units) {
    const factor = AUTOPOST_INTERVAL_UNIT_MS[unit]
    if (ms % factor === 0) {
      return { value: ms / factor, unit }
    }
  }
  return { value: Math.max(1, Math.round(ms / 1000)), unit: "seconds" }
}

export const autopostIntervalUnitSchema = z.enum(AUTOPOST_INTERVAL_UNITS)

export const autopostIntervalPatchSchema = z
  .object({
    value: z
      .number({ error: "Introduce un número entero." })
      .int("Introduce un número entero.")
      .positive("Introduce un número mayor que 0."),
    unit: autopostIntervalUnitSchema,
  })
  .superRefine((data, ctx) => {
    const ms = autopostIntervalToMs(data.value, data.unit)
    if (ms < AUTOPOST_INTERVAL_MS_MIN || ms > AUTOPOST_INTERVAL_MS_MAX) {
      ctx.addIssue({
        code: "custom",
        message: AUTOPOST_INTERVAL_RANGE_MESSAGE,
        path: ["value"],
      })
    }
  })

/** Cents a duplicate price ends in on a non-default account: 98 gives 59,95 -> 59,98. */
export const PRICE_ENDING_MIN = 0
export const PRICE_ENDING_MAX = 99

export const accountPriceEndingSchema = z.object({
  priceEnding: z
    .number({ error: "Introduce un número entero." })
    .int("Introduce un número entero.")
    .min(PRICE_ENDING_MIN, "La terminación va de 0 a 99.")
    .max(PRICE_ENDING_MAX, "La terminación va de 0 a 99."),
})

export type AccountCreateInput = z.infer<typeof accountCreateSchema>
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>
export type AccountStatus = z.infer<typeof accountStatusSchema>
export type WallapopConnectionStatus = z.infer<
  typeof wallapopConnectionStatusSchema
>
export type WallapopConnectInput = z.infer<typeof wallapopConnectSchema>
export type WallapopProxyInput = z.infer<typeof wallapopProxySchema>
export type Wallapop2faInput = z.infer<typeof wallapop2faSchema>
export type AutopostIntervalPatchInput = z.infer<
  typeof autopostIntervalPatchSchema
>
