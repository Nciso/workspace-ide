// Minimal PocketBase REST client.
//
// In dev, Vite proxies /api to the running runtime (see vite.config.ts).
// In prod the UI is served by the same binary, so /api is same-origin.

export interface PBRecord {
  id: string
  [key: string]: unknown
}

const API = "/api"

export async function listRecords(collection: string): Promise<PBRecord[]> {
  const res = await fetch(
    `${API}/collections/${collection}/records?perPage=200&sort=-created`
  )
  if (!res.ok) throw new Error(`Failed to load ${collection}: ${res.status}`)
  const body = await res.json()
  return body.items as PBRecord[]
}
