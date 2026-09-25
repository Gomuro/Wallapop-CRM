import { Router } from "express"

import { notImplemented } from "../lib/http-error"

export const catalog = Router()

catalog.get("/categories", notImplemented)
catalog.get("/categories/:id", notImplemented)

catalog.get("/products", notImplemented)
catalog.post("/products", notImplemented)
catalog.get("/products/:id", notImplemented)
catalog.patch("/products/:id", notImplemented)
catalog.delete("/products/:id", notImplemented)
catalog.patch("/products/:id/status", notImplemented)
catalog.post("/products/:id/sold", notImplemented)

catalog.post("/products/:id/images", notImplemented)
catalog.patch("/products/:id/images", notImplemented)
catalog.put("/products/:id/images/:imageId", notImplemented)
catalog.delete("/products/:id/images/:imageId", notImplemented)

catalog.get("/products/:id/listing", notImplemented)
catalog.put("/products/:id/listing", notImplemented)

catalog.get("/accounts/default", notImplemented)
