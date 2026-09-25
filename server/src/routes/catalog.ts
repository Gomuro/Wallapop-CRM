import { Router } from "express"

import {
  uploadProductImages,
  uploadReplaceImage,
} from "../middleware/upload"
import { notImplemented } from "../lib/http-error"
import { getDefaultAccount } from "./accounts"
import {
  getCategory,
  listCategories,
} from "./categories"
import {
  getProductListing,
  putProductListing,
} from "./product-listings"
import {
  deleteProductImage,
  patchProductImages,
  postProductImages,
  putProductImage,
} from "./product-images"
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  patchProduct,
  patchProductStatus,
  postProductSold,
} from "./products"

export const catalog = Router()

catalog.get("/categories", listCategories)
catalog.get("/categories/:id", getCategory)

catalog.get("/products", listProducts)
catalog.post("/products", createProduct)
catalog.get("/products/:id", getProduct)
catalog.patch("/products/:id", patchProduct)
catalog.delete("/products/:id", deleteProduct)
catalog.patch("/products/:id/status", patchProductStatus)
catalog.post("/products/:id/sold", postProductSold)

catalog.post("/products/:id/images", uploadProductImages, postProductImages)
catalog.patch("/products/:id/images", patchProductImages)
catalog.put(
  "/products/:id/images/:imageId",
  uploadReplaceImage,
  putProductImage,
)
catalog.delete("/products/:id/images/:imageId", deleteProductImage)

catalog.get("/products/:id/listing", getProductListing)
catalog.put("/products/:id/listing", putProductListing)

catalog.get("/accounts/default", getDefaultAccount)
