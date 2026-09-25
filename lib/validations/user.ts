import { z } from "zod"

export const userCreateSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128, "Password is too long."),
  name: z.string().trim().min(1, "Enter a name.").max(100, "Name is too long."),
})

export const userLoginSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(1, "Enter a password."),
})

export type UserCreateInput = z.infer<typeof userCreateSchema>
export type UserLoginInput = z.infer<typeof userLoginSchema>
