import "dotenv/config"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error("DATABASE_URL is not set")
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
})

const images = (ids: number[]) =>
  ids.map((id) => `https://picsum.photos/id/${id}/800/800`)

async function main() {
  await prisma.productListing.deleteMany()
  await prisma.product.deleteMany()
  await prisma.account.deleteMany()

  const [ana, warehouse, outlet] = await Promise.all([
    prisma.account.create({ data: { id: "acc_ana", name: "Ana BCN" } }),
    prisma.account.create({
      data: { id: "acc_wh", name: "Warehouse BCN" },
    }),
    prisma.account.create({ data: { id: "acc_mad", name: "Outlet MAD" } }),
  ])

  await prisma.product.create({
    data: {
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
      listings: {
        create: [
          {
            accountId: ana.id,
            externalUrl: "https://es.wallapop.com/item/iphone-13",
            status: "ACTIVE",
          },
          {
            accountId: warehouse.id,
            status: "READY_TO_POST",
          },
        ],
      },
    },
  })

  await prisma.product.create({
    data: {
      id: "prd_lamp",
      sku: "HM-LMP-014",
      title: "Vintage brass table lamp",
      description:
        "Working E27 socket. Shade included. Pickup in Eixample.",
      price: 45,
      category: "Home",
      condition: "As good as new",
      weight: 1.8,
      images: images([201, 202, 203, 204, 206, 208]),
      listings: {
        create: [
          {
            accountId: outlet.id,
            externalUrl: "https://es.wallapop.com/item/brass-lamp",
            status: "ACTIVE",
          },
        ],
      },
    },
  })

  await prisma.product.create({
    data: {
      id: "prd_bike",
      sku: "SP-TRK-009",
      title: "Trek FX 3 disc hybrid bike L",
      description: "Recently serviced. Hydraulic disc brakes. Sold locally.",
      price: 390,
      category: "Sports",
      condition: "Good",
      weight: 11.2,
      status: "SOLD",
      images: images([111, 112, 113, 114, 116, 117]),
      listings: {
        create: [
          {
            accountId: ana.id,
            externalUrl: "https://es.wallapop.com/item/trek-fx3",
            status: "DEACTIVATED",
          },
        ],
      },
    },
  })

  await prisma.product.create({
    data: {
      id: "prd_dunks",
      sku: "FS-NK-221",
      title: "Nike Dunk Low panda 42",
      description: "Worn twice. Extra laces. Stored in box.",
      price: 95,
      category: "Fashion",
      condition: "As good as new",
      weight: 0.9,
      status: "INACTIVE",
      images: images([21, 22, 23, 24, 25, 26]),
    },
  })

  await prisma.product.create({
    data: {
      id: "prd_desk",
      sku: "HM-DSK-003",
      title: "IKEA Bekant desk 160cm white",
      description: "Cable tray included. Minor mark on the left edge.",
      price: 70,
      category: "Home",
      condition: "Good",
      weight: 26,
      images: images([36, 37, 38, 39, 40, 41]),
      listings: {
        create: [{ accountId: warehouse.id, status: "ACTIVE" }],
      },
    },
  })

  await prisma.product.create({
    data: {
      id: "prd_sony",
      sku: "EL-SNY-088",
      title: "Sony WH-1000XM5 black",
      description: "Case, cable, and original invoice from 2024.",
      price: 185,
      category: "Electronics",
      condition: "As good as new",
      weight: 0.25,
      images: images([60, 61, 62, 63, 64, 65, 66]),
      listings: {
        create: [
          {
            accountId: ana.id,
            externalUrl: "https://es.wallapop.com/item/sony-xm5",
            status: "ACTIVE",
          },
          {
            accountId: outlet.id,
            status: "DEACTIVATED",
          },
        ],
      },
    },
  })

  await prisma.product.create({
    data: {
      id: "prd_lego",
      sku: "TY-LG-447",
      title: "LEGO Technic Porsche 911",
      description: "Complete with instructions. Built once and boxed.",
      price: 110,
      category: "Toys",
      condition: "Good",
      weight: 2.4,
      images: images([76, 77, 78, 79, 80, 82]),
    },
  })

  await prisma.product.create({
    data: {
      id: "prd_coffee",
      sku: "HM-CF-019",
      title: "De'Longhi Dedica espresso machine",
      description: "Descaled. Portafilter and tamper included.",
      price: 85,
      category: "Home",
      condition: "Good",
      weight: 4.2,
      status: "SOLD",
      images: images([30, 31, 32, 33, 34, 35]),
      listings: {
        create: [
          {
            accountId: outlet.id,
            externalUrl: "https://es.wallapop.com/item/dedica",
            status: "DEACTIVATED",
          },
        ],
      },
    },
  })
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
