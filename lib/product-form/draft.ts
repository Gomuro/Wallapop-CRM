const TEXT_KEY = "wallapop-crm.product-draft.new"
const DB_NAME = "wallapop-crm"
const STORE = "draft-photos"

export type ProductDraftFields = {
  title: string
  sku: string
  description: string
  price: string
  weight: string
  categoryId: string
  condition: string
  status: string
}

export function loadDraftFields(): ProductDraftFields | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(TEXT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ProductDraftFields
    if (!parsed || typeof parsed !== "object") return null
    return parsed
  } catch {
    return null
  }
}

export function saveDraftFields(fields: ProductDraftFields) {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(TEXT_KEY, JSON.stringify(fields))
  } catch {
    // quota / private mode
  }
}

export function clearDraftFields() {
  if (typeof window === "undefined") return
  try {
    sessionStorage.removeItem(TEXT_KEY)
  } catch {
    // ignore
  }
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const req = window.indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

export async function saveDraftPhotos(files: File[]) {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).put(files, "new")
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  db.close()
}

export async function loadDraftPhotos(): Promise<File[]> {
  const db = await openDb()
  if (!db) return []
  const files = await new Promise<File[]>((resolve) => {
    const tx = db.transaction(STORE, "readonly")
    const req = tx.objectStore(STORE).get("new")
    req.onsuccess = () => {
      resolve(Array.isArray(req.result) ? req.result : [])
    }
    req.onerror = () => resolve([])
  })
  db.close()
  return files
}

export async function clearDraftPhotos() {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).delete("new")
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  db.close()
}
