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

export type AccountCreateInput = z.infer<typeof accountCreateSchema>
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>
export type AccountStatus = z.infer<typeof accountStatusSchema>
