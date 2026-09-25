import { Router } from "express"

import { notImplemented } from "../lib/http-error"
import { getDefaultAccount } from "./accounts"
import {
  getCategory,
  listCategories,
} from "./categories"
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  patchProduct,
} from "./products"

export const catalog = Router()

catalog.get("/categories", listCategories)
catalog.get("/categories/:id", getCategory)

catalog.get("/products", listProducts)
catalog.post("/products", createProduct)
catalog.get("/products/:id", getProduct)
catalog.patch("/products/:id", patchProduct)
catalog.delete("/products/:id", deleteProduct)
catalog.patch("/products/:id/status", notImplemented)
catalog.post("/products/:id/sold", notImplemented)

catalog.post("/products/:id/images", notImplemented)
catalog.patch("/products/:id/images", notImplemented)
catalog.put("/products/:id/images/:imageId", notImplemented)
catalog.delete("/products/:id/images/:imageId", notImplemented)

catalog.get("/products/:id/listing", notImplemented)
catalog.put("/products/:id/listing", notImplemented)

catalog.get("/accounts/default", getDefaultAccount)
