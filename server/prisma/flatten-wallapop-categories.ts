export type WallapopApiNode = {
  id: number | string
  name: string
  subcategories?: WallapopApiNode[]
  category_leaf_selection_mandatory?: boolean
  vertical_id?: string | null
  attributes?: unknown
}

export type FlatCategory = {
  wallapopId: number
  parentWallapopId: number | null
  slug: string
  nameEs: string
  nameUk: string
  isLeaf: boolean
  leafSelectionMandatory: boolean
  verticalId: string | null
  listingType: string
  /** wallapop_id segments + trailing slash, e.g. "24200/24201/24203/" */
  path: string
  depth: number
  attributes: unknown
  seoLegacyId: number | null
  sortOrder: number
}

const ROOT_SLUGS: Record<number, string> = {
  100: "coches-segunda-mano",
  14000: "motos",
  12800: "motor-y-accesorios",
  12465: "moda-y-complementos",
  200: "inmobiliaria",
  24200: "tv-audio-foto",
  12579: "deporte-y-ocio",
  17000: "bicicletas",
  12467: "muebles-deco-y-jardin",
  13100: "electrodomesticos",
  12463: "libros-pelis-musica",
  12461: "ninos-y-bebes",
  18000: "coleccionismo",
  19000: "construccion-y-reformas",
  20000: "industria-agricultura",
  21000: "empleo",
  13200: "servicios",
  12485: "otros",
}

/** seo_legacy_id lives on the *current* API node that replaced the old nav id */
const SEO_LEGACY_ON_NODE: Record<number, number> = {
  24200: 12545,
  24201: 16000,
  24202: 15000,
  24203: 12900,
}

const MODA_ROOT = 12465
const PATH_MAX_LEN = 255
const PATH_PATTERN = /^\d+(\/\d+)*\/$/

export const WALLAPOP_TREE_COUNTS = {
  roots: 18,
  nodes: 997,
  leaves: 859,
  maxDepth: 5,
} as const

/**
 * Query contract for Category.path (hybrid: parent_id + materialized path).
 * Descendants of Electronics wallapop_id=24200 (self + children):
 *   WHERE path LIKE '24200/%'
 * Breadcrumbs: split path by `/`, drop empties, lookup those wallapop_ids in order.
 * Products later: category_id IN (SELECT id FROM categories WHERE path LIKE '24200/%')
 * Not Closure Table / Nested Set / recursive CTE as the primary read path.
 */

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function listingType(rootId: number, verticalId: string | null): string {
  if (verticalId === "cars" || rootId === 100) return "car"
  if (verticalId === "real_estate" || rootId === 200) return "realEstate"
  if (rootId === MODA_ROOT) return "fashion"
  return "consumerGoods"
}

function childPath(parentPath: string, wallapopId: number): string {
  return `${parentPath}${wallapopId}/`
}

function walk(
  nodes: WallapopApiNode[],
  parentWallapopId: number | null,
  parentPath: string,
  depth: number,
  rootId: number | null,
  inheritedMandatory: boolean,
  rows: FlatCategory[],
) {
  nodes.forEach((node, index) => {
    const id = Number(node.id)
    const kids = node.subcategories ?? []
    const currentRoot = depth === 1 ? id : (rootId as number)
    const mandatory =
      depth === 1
        ? Boolean(node.category_leaf_selection_mandatory)
        : inheritedMandatory
    const verticalId = node.vertical_id ?? null
    const path = childPath(parentPath, id)

    rows.push({
      wallapopId: id,
      parentWallapopId,
      slug:
        depth === 1
          ? (ROOT_SLUGS[id] ?? `${slugify(node.name)}-${id}`)
          : `${slugify(node.name) || "cat"}-${id}`,
      nameEs: node.name,
      nameUk: node.name,
      isLeaf: kids.length === 0,
      leafSelectionMandatory: mandatory,
      verticalId,
      listingType: listingType(currentRoot, verticalId),
      path,
      depth,
      attributes: node.attributes ?? {},
      seoLegacyId: SEO_LEGACY_ON_NODE[id] ?? null,
      sortOrder: index,
    })

    if (kids.length) {
      walk(kids, id, path, depth + 1, currentRoot, mandatory, rows)
    }
  })
}

export function flattenWallapopCategories(payload: {
  categories?: WallapopApiNode[]
}): FlatCategory[] {
  const roots = payload.categories ?? []
  const rows: FlatCategory[] = []
  walk(roots, null, "", 1, null, false, rows)
  return rows
}

function expectedPathFromAncestors(
  row: FlatCategory,
  byId: Map<number, FlatCategory>,
): string {
  const ids: number[] = []
  let current: FlatCategory | undefined = row
  const seen = new Set<number>()
  while (current) {
    if (seen.has(current.wallapopId)) {
      throw new Error(`Cycle in category tree at wallapop_id=${current.wallapopId}`)
    }
    seen.add(current.wallapopId)
    ids.unshift(current.wallapopId)
    current =
      current.parentWallapopId == null
        ? undefined
        : byId.get(current.parentWallapopId)
  }
  return `${ids.join("/")}/`
}

export function assertWallapopTreePaths(rows: FlatCategory[]) {
  const byId = new Map(rows.map((row) => [row.wallapopId, row]))
  for (const row of rows) {
    if (!PATH_PATTERN.test(row.path)) {
      throw new Error(
        `Invalid path for wallapop_id=${row.wallapopId}: ${JSON.stringify(row.path)}`,
      )
    }
    if (!row.path.endsWith("/")) {
      throw new Error(`Path must end with / for wallapop_id=${row.wallapopId}`)
    }
    if (row.path.length > PATH_MAX_LEN) {
      throw new Error(
        `Path longer than VARCHAR(255) for wallapop_id=${row.wallapopId}: ${row.path.length}`,
      )
    }
    const expected = expectedPathFromAncestors(row, byId)
    if (row.path !== expected) {
      throw new Error(
        `Path mismatch for wallapop_id=${row.wallapopId}: got ${row.path}, expected ${expected}`,
      )
    }
    if (row.depth === 1 && row.path !== `${row.wallapopId}/`) {
      throw new Error(`Root path must be "${row.wallapopId}/"`)
    }
  }
}

export function assertWallapopTreeCounts(rows: FlatCategory[]) {
  const roots = rows.filter((row) => row.parentWallapopId === null).length
  const leaves = rows.filter((row) => row.isLeaf).length
  const maxDepth = Math.max(...rows.map((row) => row.depth))
  const ok =
    roots === WALLAPOP_TREE_COUNTS.roots &&
    rows.length === WALLAPOP_TREE_COUNTS.nodes &&
    leaves === WALLAPOP_TREE_COUNTS.leaves &&
    maxDepth === WALLAPOP_TREE_COUNTS.maxDepth
  if (!ok) {
    throw new Error(
      `Wallapop tree counts mismatch: got roots=${roots} nodes=${rows.length} leaves=${leaves} maxDepth=${maxDepth}; expected ${WALLAPOP_TREE_COUNTS.roots}/${WALLAPOP_TREE_COUNTS.nodes}/${WALLAPOP_TREE_COUNTS.leaves}/${WALLAPOP_TREE_COUNTS.maxDepth}`,
    )
  }
  assertWallapopTreePaths(rows)
}
