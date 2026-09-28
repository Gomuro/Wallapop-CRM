import { z } from "zod"

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

export const wallapopConnectSchema = z.object({
  email: z.string().trim().email("Introduce un email válido.").max(254),
  password: z.string().min(1, "Introduce la contraseña.").max(200),
  proxy: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((value) => {
      if (value == null) return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    }),
})

export const wallapop2faSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4, "Introduce el código 2FA.")
    .max(8, "El código 2FA no es válido.")
    .regex(/^[A-Za-z0-9]+$/, "El código 2FA no es válido."),
})

export type AccountCreateInput = z.infer<typeof accountCreateSchema>
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>
export type AccountStatus = z.infer<typeof accountStatusSchema>
export type WallapopConnectionStatus = z.infer<
  typeof wallapopConnectionStatusSchema
>
export type WallapopConnectInput = z.infer<typeof wallapopConnectSchema>
export type Wallapop2faInput = z.infer<typeof wallapop2faSchema>
