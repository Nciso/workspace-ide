// Minimal PocketBase REST client.
//
// In dev, Vite proxies /api to the running runtime (see vite.config.ts).
// In prod the UI is served by the same binary, so /api is same-origin.

export interface PBRecord {
  id: string
  [key: string]: unknown
}

const API = "/api"

async function fail(res: Response, what: string): Promise<never> {
  // Surface the API's own validation message — "Failed to load x: 400" tells nobody why.
  let detail = ""
  try {
    const body = await res.json()
    detail = body?.message ? `: ${body.message}` : ""
  } catch {
    /* non-JSON error body */
  }
  throw new Error(`${what} (${res.status})${detail}`)
}

// `sort` and `filter` come from the view spec. Neither is defaulted: sorting by "-created"
// 400s on a collection without that optional field, and an unasked-for filter would hide
// records the view meant to show.
export async function listRecords(
  collection: string,
  sort?: string,
  filter?: string
): Promise<PBRecord[]> {
  const query = new URLSearchParams({ perPage: "200" })
  if (sort) query.set("sort", sort)
  if (filter) query.set("filter", filter)
  const res = await fetch(`${API}/collections/${collection}/records?${query}`)
  if (!res.ok) await fail(res, `Failed to load ${collection}`)
  const body = await res.json()
  return body.items as PBRecord[]
}

export async function getRecord(collection: string, id: string): Promise<PBRecord> {
  const res = await fetch(`${API}/collections/${collection}/records/${id}`)
  if (!res.ok) await fail(res, `Failed to load ${collection} record`)
  return (await res.json()) as PBRecord
}

export async function updateRecord(
  collection: string,
  id: string,
  patch: Record<string, unknown>
): Promise<PBRecord> {
  const res = await fetch(`${API}/collections/${collection}/records/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  })
  if (!res.ok) await fail(res, `Failed to update ${collection}`)
  return (await res.json()) as PBRecord
}
