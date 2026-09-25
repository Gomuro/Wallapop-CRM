import { Router } from "express"

import { requireAuth } from "../middleware/require-auth"
import { login, logout, me } from "./auth"
import { catalog } from "./catalog"

export const v1 = Router()

v1.post("/auth/login", login)
v1.use(requireAuth)
v1.post("/auth/logout", logout)
v1.get("/auth/me", me)
v1.use(catalog)
