import { z } from "zod"

export const userCreateSchema = z.object({
  email: z.string().trim().email("Introduce un email válido."),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres.")
    .max(128, "La contraseña es demasiado larga."),
  name: z.string().trim().min(1, "Introduce un nombre.").max(100, "El nombre es demasiado largo."),
})

export const userLoginSchema = z.object({
  email: z.string().trim().email("Introduce un email válido."),
  password: z.string().min(1, "Introduce una contraseña."),
})

export type UserCreateInput = z.infer<typeof userCreateSchema>
export type UserLoginInput = z.infer<typeof userLoginSchema>
