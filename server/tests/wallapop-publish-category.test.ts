import { chromium, type Browser } from "playwright"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ensureCategorySelected } from "../src/lib/wallapop-publish/category"

type PickerConfig = {
  /** "root" and every parent name → the rows Wallapop shows for it. */
  levels: Record<string, string[]>
  leaves: Record<string, string>
  /** Wallapop's own pick, already on the closed control. */
  suggestion?: { leaf: string; path: string; leafId: string }
  /** A parent click empties the list for this long before the next one paints. */
  blankMs?: number
  /** After the first scroll in this list, Wallapop moves it back by `rows` rows. */
  settle?: { level: string; rows: number }
  listHeight?: number
}

const ROW_PX = 36

/** Category menu that walks level by level, like UploadCategoriesSelector. */
function categoryPickerHtml(cfg: PickerConfig): string {
  return `<!DOCTYPE html><body>
    <h1>Selecciona una categoría</h1>
    <walla-dropdown>
      <div class="walla-dropdown__inner-input" role="button" id="cat-button" style="display:block;height:40px">
        <span class="subText"></span>
      </div>
    </walla-dropdown>
    <div id="panel"></div>
    <input id="category_leaf_id" value="">
    <script type="application/json" id="cfg">${JSON.stringify(cfg)}</script>
    <script>
      const cfg = JSON.parse(document.getElementById("cfg").textContent)
      const panel = document.getElementById("panel")
      const button = document.getElementById("cat-button")
      const leafInput = document.getElementById("category_leaf_id")
      window.clicks = []
      button.setAttribute("aria-label", "Categoría y subcategoría" + (cfg.suggestion ? ", " + cfg.suggestion.leaf : ""))
      button.querySelector("span.subText").textContent = cfg.suggestion ? cfg.suggestion.path : ""
      leafInput.value = cfg.suggestion ? cfg.suggestion.leafId : ""
      function render(level) {
        const box = document.createElement("div")
        box.setAttribute("role", "listbox")
        box.style.cssText = "display:block;overflow:auto;width:320px;height:" + (cfg.listHeight || 216) + "px"
        for (const name of cfg.levels[level]) {
          const item = document.createElement("walla-dropdown-item")
          item.setAttribute("role", "option")
          item.setAttribute("aria-label", name)
          item.style.cssText = "display:block;height:${ROW_PX}px"
          item.textContent = name
          box.appendChild(item)
        }
        if (cfg.settle && cfg.settle.level === level) {
          let settled = false
          box.addEventListener("scroll", () => {
            if (settled || box.scrollTop === 0) return
            settled = true
            setTimeout(() => { box.scrollTop -= cfg.settle.rows * ${ROW_PX} }, 60)
          })
        }
        panel.replaceChildren(box)
      }
      document.querySelector("walla-dropdown").addEventListener("click", () => {
        if (!panel.querySelector('[role="listbox"]')) render("root")
      })
      panel.addEventListener("click", (event) => {
        const item = event.target.closest("walla-dropdown-item")
        if (!item) return
        const name = item.getAttribute("aria-label")
        window.clicks.push(name)
        if (cfg.levels[name]) {
          if (!cfg.blankMs) return render(name)
          panel.querySelector('[role="listbox"]').replaceChildren()
          setTimeout(() => render(name), cfg.blankMs)
          return
        }
        if (cfg.leaves[name]) {
          button.setAttribute("aria-label", "Categoría y subcategoría, " + name)
          button.querySelector("span.subText").textContent = ""
          leafInput.value = cfg.leaves[name]
          panel.replaceChildren()
        }
      })
    </script>
  </body>`
}

/** Niños y bebés as Wallapop listed it on 2026-10-22. */
const NINOS_Y_BEBES = [
  'Sólo seleccionar "Niños y bebés"',
  "Accesorios de baño",
  "Alimentación del bebé",
  "Artículos de maternidad",
  "Artículos escolares",
  "Cunas y camas",
  "Disfraces infantiles",
  "Juguetes, juegos y peluches",
  "Mobiliario infantil",
  "Ropa infantil",
  "Seguridad y cuidado",
  "Transporte del bebé",
  "Tronas y andadores",
  "Otros",
]

/** Wallapop's guess for "Asiento delantero de bicicleta para niños" (WP-907422). */
const SILLIN = {
  leaf: "Sillín",
  path: "Bicicletas > Piezas y recambios de bici",
  leafId: "10227",
}

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
})

afterAll(async () => {
  await browser?.close()
})

async function pick(cfg: PickerConfig, labels: string[]) {
  const page = await browser.newPage()
  try {
    await page.setContent(categoryPickerHtml(cfg))
    const error = await ensureCategorySelected(page, labels).then(
      () => null,
      (caught: unknown) => (caught instanceof Error ? caught.message : String(caught)),
    )
    return {
      error,
      leafId: await page.locator("#category_leaf_id").inputValue(),
      clicks: (await page.evaluate("window.clicks")) as string[],
    }
  } finally {
    await page.close()
  }
}

describe("category pick", () => {
  it("keeps walking when the next list paints after a blank moment", async () => {
    const result = await pick(
      {
        levels: {
          root: ["Hogar y jardín", "Niños y bebés", "Otros"],
          "Niños y bebés": ['Sólo seleccionar "Niños y bebés"', "Cunas y camas", "Tronas y andadores", "Otros"],
          "Cunas y camas": ["Camas infantiles", "Cunas"],
        },
        leaves: { Cunas: "10357", "Camas infantiles": "10356", Otros: "10186" },
        blankMs: 400,
      },
      ["Niños y bebés", "Cunas y camas", "Cunas"],
    )
    expect(result.error).toBeNull()
    expect(result.leafId).toBe("10357")
  })

  it("clicks Otros, not Transporte del bebé, when the list moves after the scroll", async () => {
    const result = await pick(
      {
        levels: {
          root: ["Hogar y jardín", "Niños y bebés", "Otros"],
          "Niños y bebés": NINOS_Y_BEBES,
          "Transporte del bebé": ["Cochecitos", "Portabebés", "Sillas de coche", "Sillas de paseo"],
          "Tronas y andadores": ["Andadores", "Correpasillos", "Tronas"],
        },
        leaves: { Otros: "10186", Tronas: "10384", Cochecitos: "10352" },
        suggestion: SILLIN,
        settle: { level: "Niños y bebés", rows: 2 },
      },
      ["Niños y bebés", "Otros"],
    )
    expect(result.error).toBeNull()
    expect(result.clicks).not.toContain("Transporte del bebé")
    expect(result.leafId).toBe("10186")
  })

  it("walks from the root to Aire acondicionado when CRM nameEs has a trailing space", async () => {
    const result = await pick(
      {
        levels: {
          root: ["Hogar y jardín", "Motos"],
          "Hogar y jardín": ["Calefacción y climatización", "Cocina"],
          "Calefacción y climatización": [
            "Chimeneas, Estufas y radiadores",
            "Aire acondicionado y ventiladores",
            "Combustibles y pellet",
          ],
        },
        leaves: { "Aire acondicionado y ventiladores": "24280" },
      },
      ["Hogar y jardín", "Calefacción y climatización", "Aire acondicionado y ventiladores "],
    )
    expect(result.error).toBeNull()
    expect(result.leafId).toBe("24280")
  })

  it("walks from the root and clicks the last row inside a short overflow list", async () => {
    const result = await pick(
      {
        levels: {
          root: ["Hogar y jardín", "Motos"],
          "Hogar y jardín": ["Calefacción y climatización", "Cocina"],
          Cocina: [
            "Menaje para cocinar, comer y beber",
            "Picas y muebles cocina",
            "Grifería de cocina",
            "Textiles de cocina y comedor",
            "Accesorios",
          ],
        },
        leaves: { Accesorios: "24299", "Textiles de cocina y comedor": "24298" },
        listHeight: 72,
      },
      ["Hogar y jardín", "Cocina", "Accesorios"],
    )
    expect(result.error).toBeNull()
    expect(result.leafId).toBe("24299")
  })
})
