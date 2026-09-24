import { nanoid } from "nanoid"

import type { InventoryProduct, MarkSoldResult } from "@/lib/inventory/types"
import type { ProductCreateInput, ProductUpdateInput } from "@/lib/validations"

const images = (ids: number[]) =>
  ids.map((id) => `https://picsum.photos/id/${id}/800/800`)

function nowIso() {
  return new Date().toISOString()
}

function seedProducts(): InventoryProduct[] {
  const created = nowIso()
  return [
    {
      id: "prd_iphone13",
      sku: "EL-IP13-001",
      title: "iPhone 13 128GB midnight",
      description:
        "Battery 87%. Original box and cable. No scratches on screen.",
      price: 329,
      category: "Electronics",
      condition: "Good",
      weight: 0.24,
      images: images([101, 102, 103, 104, 106, 107]),
      status: "ACTIVE",
      externalLinks: [],
      createdAt: created,
      updatedAt: created,
      listings: [
        {
          id: "lst_iphone_ana",
          accountId: "acc_ana",
          accountName: "Ana BCN",
          externalUrl: "https://es.wallapop.com/item/iphone-13",
          status: "ACTIVE",
        },
        {
          id: "lst_iphone_wh",
          accountId: "acc_wh",
          accountName: "Warehouse BCN",
          externalUrl: null,
          status: "READY_TO_POST",
        },
      ],
    },
    {
      id: "prd_lamp",
      sku: "HM-LMP-014",
      title: "Vintage brass table lamp",
      description: "Working E27 socket. Shade included. Pickup in Eixample.",
      price: 45,
      category: "Home",
      condition: "As good as new",
      weight: 1.8,
      images: images([201, 202, 203, 204, 206, 208]),
      status: "ACTIVE",
      externalLinks: [],
      createdAt: created,
      updatedAt: created,
      listings: [
        {
          id: "lst_lamp_mad",
          accountId: "acc_mad",
          accountName: "Outlet MAD",
          externalUrl: "https://es.wallapop.com/item/brass-lamp",
          status: "ACTIVE",
        },
      ],
    },
    {
      id: "prd_bike",
      sku: "SP-TRK-009",
      title: "Trek FX 3 disc hybrid bike L",
      description: "Recently serviced. Hydraulic disc brakes. Sold locally.",
      price: 390,
      category: "Sports",
      condition: "Good",
      weight: 11.2,
      images: images([111, 112, 113, 114, 116, 117]),
      status: "SOLD",
      externalLinks: [],
      createdAt: created,
      updatedAt: created,
      listings: [
        {
          id: "lst_bike_ana",
          accountId: "acc_ana",
          accountName: "Ana BCN",
          externalUrl: "https://es.wallapop.com/item/trek-fx3",
          status: "DEACTIVATED",
        },
      ],
    },
    {
      id: "prd_dunks",
      sku: "FS-NK-221",
      title: "Nike Dunk Low panda 42",
      description: "Worn twice. Extra laces. Stored in box.",
      price: 95,
      category: "Fashion",
      condition: "As good as new",
      weight: 0.9,
      images: images([21, 22, 23, 24, 25, 26]),
      status: "INACTIVE",
      externalLinks: [],
      createdAt: created,
      updatedAt: created,
      listings: [],
    },
    {
      id: "prd_desk",
      sku: "HM-DSK-003",
      title: "IKEA Bekant desk 160cm white",
      description: "Cable tray included. Minor mark on the left edge.",
      price: 70,
      category: "Home",
      condition: "Good",
      weight: 26,
      images: images([36, 37, 38, 39, 40, 41]),
      status: "ACTIVE",
      externalLinks: [],
      createdAt: created,
      updatedAt: created,
      listings: [
        {
          id: "lst_desk_wh",
          accountId: "acc_wh",
          accountName: "Warehouse BCN",
          externalUrl: null,
          status: "ACTIVE",
        },
      ],
    },
    {
      id: "prd_sony",
      sku: "EL-SNY-088",
      title: "Sony WH-1000XM5 black",
      description: "Case, cable, and original invoice from 2024.",
      price: 185,
      category: "Electronics",
      condition: "As good as new",
      weight: 0.25,
      images: images([60, 61, 62, 63, 64, 65, 66]),
      status: "ACTIVE",
      externalLinks: [],
      createdAt: created,
      updatedAt: created,
      listings: [
        {
          id: "lst_sony_ana",
          accountId: "acc_ana",
          accountName: "Ana BCN",
          externalUrl: "https://es.wallapop.com/item/sony-xm5",
          status: "ACTIVE",
        },
        {
          id: "lst_sony_mad",
          accountId: "acc_mad",
          accountName: "Outlet MAD",
          externalUrl: null,
          status: "DEACTIVATED",
        },
      ],
    },
    {
      id: "prd_lego",
      sku: "TY-LG-447",
      title: "LEGO Technic Porsche 911",
      description: "Complete with instructions. Built once and boxed.",
      price: 110,
      category: "Toys",
      condition: "Good",
      weight: 2.4,
      images: images([76, 77, 78, 79, 80, 82]),
      status: "ACTIVE",
      externalLinks: [],
      createdAt: created,
      updatedAt: created,
      listings: [],
    },
    {
      id: "prd_coffee",
      sku: "HM-CF-019",
      title: "De'Longhi Dedica espresso machine",
      description: "Descaled. Portafilter and tamper included.",
      price: 85,
      category: "Home",
      condition: "Good",
      weight: 4.2,
      images: images([30, 31, 32, 33, 34, 35]),
      status: "SOLD",
      externalLinks: [],
      createdAt: created,
      updatedAt: created,
      listings: [
        {
          id: "lst_coffee_mad",
          accountId: "acc_mad",
          accountName: "Outlet MAD",
          externalUrl: "https://es.wallapop.com/item/dedica",
          status: "DEACTIVATED",
        },
      ],
    },
  ]
}

type MemoryState = {
  products: InventoryProduct[]
}

const globalForMemory = globalThis as unknown as {
  wallapopMemory?: MemoryState
}

function state(): MemoryState {
  if (!globalForMemory.wallapopMemory) {
    globalForMemory.wallapopMemory = { products: seedProducts() }
  }
  return globalForMemory.wallapopMemory
}

function cloneProduct(product: InventoryProduct): InventoryProduct {
  return structuredClone(product)
}

function skuTaken(sku: string, exceptId?: string) {
  return state().products.some(
    (product) => product.sku === sku && product.id !== exceptId,
  )
}

function uniqueSkuError(): never {
  const error = new Error("Unique constraint failed on the fields: (`sku`)") as Error & {
    code: string
  }
  error.code = "P2002"
  throw error
}

export function memoryListProducts(query: {
  q?: string
  status?: InventoryProduct["status"] | "ALL"
}): InventoryProduct[] {
  const status = query.status ?? "ALL"
  const q = query.q?.trim().toLowerCase() ?? ""

  return state()
    .products.filter((product) => {
      if (status !== "ALL" && product.status !== status) return false
      if (!q) return true
      return (
        product.title.toLowerCase().includes(q) ||
        product.sku.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .map(cloneProduct)
}

export function memoryGetProduct(id: string): InventoryProduct | null {
  const product = state().products.find((item) => item.id === id)
  return product ? cloneProduct(product) : null
}

export function memoryCreateProduct(input: ProductCreateInput): InventoryProduct {
  if (skuTaken(input.sku)) uniqueSkuError()
  const timestamp = nowIso()
  const product: InventoryProduct = {
    id: `prd_${nanoid(10)}`,
    sku: input.sku,
    title: input.title,
    description: input.description,
    price: input.price,
    category: input.category,
    condition: input.condition,
    weight: input.weight ?? null,
    images: input.images ?? [],
    status: input.status ?? "ACTIVE",
    externalLinks: input.externalLinks ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
    listings: [],
  }
  state().products.unshift(product)
  return cloneProduct(product)
}

export function memoryUpdateProduct(
  id: string,
  input: ProductUpdateInput,
): InventoryProduct | null {
  const products = state().products
  const index = products.findIndex((item) => item.id === id)
  if (index < 0) return null
  if (input.sku !== undefined && skuTaken(input.sku, id)) uniqueSkuError()

  const current = products[index]
  const status = input.status ?? current.status
  const next: InventoryProduct = {
    ...current,
    sku: input.sku ?? current.sku,
    title: input.title ?? current.title,
    description: input.description ?? current.description,
    price: input.price ?? current.price,
    category: input.category ?? current.category,
    condition: input.condition ?? current.condition,
    weight: input.weight === undefined ? current.weight : input.weight,
    images: input.images ?? current.images,
    status,
    externalLinks: input.externalLinks ?? current.externalLinks,
    listings:
      status === "SOLD"
        ? current.listings.map((listing) => ({
            ...listing,
            status: "DEACTIVATED",
          }))
        : current.listings,
    updatedAt: nowIso(),
  }
  products[index] = next
  return cloneProduct(next)
}

export function memoryDeleteProduct(id: string): boolean {
  const products = state().products
  const index = products.findIndex((item) => item.id === id)
  if (index < 0) return false
  products.splice(index, 1)
  return true
}

export function memoryMarkProductSold(id: string): MarkSoldResult {
  const products = state().products
  const index = products.findIndex((item) => item.id === id)
  if (index < 0) return { ok: false, reason: "not-found" }
  const current = products[index]
  if (current.status === "SOLD") return { ok: false, reason: "already-sold" }
  const next: InventoryProduct = {
    ...current,
    status: "SOLD",
    listings: current.listings.map((listing) => ({
      ...listing,
      status: "DEACTIVATED",
    })),
    updatedAt: nowIso(),
  }
  products[index] = next
  return { ok: true, product: cloneProduct(next) }
}
