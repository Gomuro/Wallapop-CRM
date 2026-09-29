import { Router } from "express"

import {
  uploadProductImages,
  uploadReplaceImage,
} from "../middleware/upload"
import {
  connectAccount,
  connectAccount2fa,
  disconnectAccount,
  getAccountConnectionStatus,
  getDefaultAccount,
  patchDefaultAccountAutopost,
  startDefaultAccountAutopost,
  stopDefaultAccountAutopost,
} from "./accounts"
import {
  getCategory,
  listCategories,
} from "./categories"
import {
  getProductListing,
  putProductListing,
} from "./product-listings"
import { publishProduct } from "./product-publish"
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
catalog.post("/products/:id/publish", publishProduct)

catalog.get("/accounts/default", getDefaultAccount)
catalog.patch("/accounts/default/autopost", patchDefaultAccountAutopost)
catalog.post("/accounts/default/autopost/start", startDefaultAccountAutopost)
catalog.post("/accounts/default/autopost/stop", stopDefaultAccountAutopost)
catalog.get("/accounts/status", getAccountConnectionStatus)
catalog.post("/accounts/connect", connectAccount)
catalog.post("/accounts/connect/2fa", connectAccount2fa)
catalog.post("/accounts/disconnect", disconnectAccount)
