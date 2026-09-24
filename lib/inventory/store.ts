import "server-only"

import type { ProductCreateInput, ProductUpdateInput } from "@/lib/validations"
import type {
  InventoryProduct,
  ProductListQuery,
} from "@/lib/inventory/types"

const now = () => new Date().toISOString()

function seed(): InventoryProduct[] {
  const stamped = now()
  return [
    {
      id: "prd_iphone13",
      sku: "EL-IP13-001",
      title: "iPhone 13 128GB midnight",
      description: "Battery 87%. Original box and cable. No scratches on screen.",
      price: 329,
      category: "Electronics",
      condition: "Good",
      weight: 0.24,
      images: [
        "https://picsum.photos/id/101/800/800",
        "https://picsum.photos/id/102/800/800",
        "https://picsum.photos/id/103/800/800",
        "https://picsum.photos/id/104/800/800",
        "https://picsum.photos/id/106/800/800",
        "https://picsum.photos/id/107/800/800",
      ],
      status: "ACTIVE",
      externalLinks: [],
      createdAt: stamped,
      updatedAt: stamped,
      listings: [
        {
          id: "lst_1",
          accountId: "acc_ana",
          accountName: "Ana BCN",
          externalUrl: "https://es.wallapop.com/item/iphone-13",
          status: "ACTIVE",
        },
        {
          id: "lst_2",
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
      images: [
        "https://picsum.photos/id/201/800/800",
        "https://picsum.photos/id/202/800/800",
        "https://picsum.photos/id/203/800/800",
        "https://picsum.photos/id/204/800/800",
        "https://picsum.photos/id/206/800/800",
        "https://picsum.photos/id/208/800/800",
      ],
      status: "ACTIVE",
      externalLinks: [],
      createdAt: stamped,
      updatedAt: stamped,
      listings: [
        {
          id: "lst_3",
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
      images: [
        "https://picsum.photos/id/111/800/800",
        "https://picsum.photos/id/112/800/800",
        "https://picsum.photos/id/113/800/800",
        "https://picsum.photos/id/114/800/800",
        "https://picsum.photos/id/116/800/800",
        "https://picsum.photos/id/117/800/800",
      ],
      status: "SOLD",
      externalLinks: [],
      createdAt: stamped,
      updatedAt: stamped,
      listings: [
        {
          id: "lst_4",
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
      images: [
        "https://picsum.photos/id/21/800/800",
        "https://picsum.photos/id/22/800/800",
        "https://picsum.photos/id/23/800/800",
        "https://picsum.photos/id/24/800/800",
        "https://picsum.photos/id/25/800/800",
        "https://picsum.photos/id/26/800/800",
      ],
      status: "INACTIVE",
      externalLinks: [],
      createdAt: stamped,
      updatedAt: stamped,
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
      images: [
        "https://picsum.photos/id/36/800/800",
        "https://picsum.photos/id/37/800/800",
        "https://picsum.photos/id/38/800/800",
        "https://picsum.photos/id/39/800/800",
        "https://picsum.photos/id/40/800/800",
        "https://picsum.photos/id/41/800/800",
      ],
      status: "ACTIVE",
      externalLinks: [],
      createdAt: stamped,
      updatedAt: stamped,
      listings: [
        {
          id: "lst_5",
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
      images: [
        "https://picsum.photos/id/60/800/800",
        "https://picsum.photos/id/61/800/800",
        "https://picsum.photos/id/62/800/800",
        "https://picsum.photos/id/63/800/800",
        "https://picsum.photos/id/64/800/800",
        "https://picsum.photos/id/65/800/800",
        "https://picsum.photos/id/66/800/800",
      ],
      status: "ACTIVE",
      externalLinks: [],
      createdAt: stamped,
      updatedAt: stamped,
      listings: [
        {
          id: "lst_6",
          accountId: "acc_ana",
          accountName: "Ana BCN",
          externalUrl: "https://es.wallapop.com/item/sony-xm5",
          status: "ACTIVE",
        },
        {
          id: "lst_7",
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
      images: [
        "https://picsum.photos/id/76/800/800",
        "https://picsum.photos/id/77/800/800",
        "https://picsum.photos/id/78/800/800",
        "https://picsum.photos/id/79/800/800",
        "https://picsum.photos/id/80/800/800",
        "https://picsum.photos/id/82/800/800",
      ],
      status: "ACTIVE",
      externalLinks: [],
      createdAt: stamped,
      updatedAt: stamped,
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
      images: [
        "https://picsum.photos/id/30/800/800",
        "https://picsum.photos/id/31/800/800",
        "https://picsum.photos/id/32/800/800",
        "https://picsum.photos/id/33/800/800",
        "https://picsum.photos/id/34/800/800",
        "https://picsum.photos/id/35/800/800",
      ],
      status: "SOLD",
      externalLinks: [],
      createdAt: stamped,
      updatedAt: stamped,
      listings: [
        {
          id: "lst_8",
          accountId: "acc_mad",
          accountName: "Outlet MAD",
          externalUrl: "https://es.wallapop.com/item/dedica",
          status: "DEACTIVATED",
        },
      ],
    },
  ]
}

type InventoryState = {
  products: InventoryProduct[]
}

const globalForInventory = globalThis as typeof globalThis & {
  __wallapopInventory?: InventoryState
}

function getState(): InventoryState {
  if (!globalForInventory.__wallapopInventory) {
    globalForInventory.__wallapopInventory = { products: seed() }
  }
  return globalForInventory.__wallapopInventory
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export function listProducts(query: ProductListQuery = {}): InventoryProduct[] {
  const status = query.status ?? "ALL"
  const q = query.q?.trim().toLowerCase() ?? ""

  return getState()
    .products.filter((product) => {
      if (status !== "ALL" && product.status !== status) return false
      if (!q) return true
      return (
        product.title.toLowerCase().includes(q) ||
        product.sku.toLowerCase().includes(q)
      )
    })
    .map(clone)
}

export function getProduct(id: string): InventoryProduct | null {
  const product = getState().products.find((item) => item.id === id)
  return product ? clone(product) : null
}

export function createProduct(input: ProductCreateInput): InventoryProduct {
  const stamped = now()
  const product: InventoryProduct = {
    id: `prd_${crypto.randomUUID().slice(0, 8)}`,
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
    createdAt: stamped,
    updatedAt: stamped,
    listings: [],
  }

  getState().products.unshift(product)
  return clone(product)
}

export function updateProduct(
  id: string,
  input: ProductUpdateInput,
): InventoryProduct | null {
  const state = getState()
  const index = state.products.findIndex((item) => item.id === id)
  if (index === -1) return null

  const current = state.products[index]
  const next: InventoryProduct = {
    ...current,
    ...input,
    weight: input.weight === undefined ? current.weight : (input.weight ?? null),
    updatedAt: now(),
  }
  state.products[index] = next
  return clone(next)
}

export function deleteProduct(id: string): boolean {
  const state = getState()
  const index = state.products.findIndex((item) => item.id === id)
  if (index === -1) return false
  state.products.splice(index, 1)
  return true
}

export function markProductSold(id: string): InventoryProduct | null {
  const state = getState()
  const product = state.products.find((item) => item.id === id)
  if (!product) return null

  product.status = "SOLD"
  product.updatedAt = now()
  product.listings = product.listings.map((listing) => ({
    ...listing,
    status: "DEACTIVATED",
  }))

  return clone(product)
}
