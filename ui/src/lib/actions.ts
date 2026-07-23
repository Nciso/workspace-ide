import { getRecord, updateRecord, type PBRecord } from "./pb"
import type { ActionSpec } from "./workspace"

/** PocketBase's datetime format, in UTC — the same shape the agent is told to write. */
export function nowStamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19)
}

function buildPatch(
  record: PBRecord,
  set?: Record<string, unknown>,
  increment?: Record<string, number>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(set ?? {})) {
    patch[field] = value === "@now" ? nowStamp() : value
  }
  for (const [field, by] of Object.entries(increment ?? {})) {
    // Read-then-write: PocketBase has no atomic increment over REST. Fine for one
    // operator clicking a button; it would drop counts under concurrent writers.
    patch[field] = Number(record[field] ?? 0) + by
  }
  return patch
}

/**
 * Applies an action to a record, and to its related record when the action declares one.
 * Returns nothing — the caller reloads, so what lands on screen is what the server stored.
 */
export async function runAction(
  collection: string,
  record: PBRecord,
  action: ActionSpec
): Promise<void> {
  await updateRecord(collection, record.id, buildPatch(record, action.set, action.increment))

  const also = action.also
  if (!also) return
  const relatedId = record[also.via]
  if (!relatedId || typeof relatedId !== "string") return
  // Re-read the related record so an increment counts from its stored value, not a stale
  // copy embedded in this row.
  const related = await getRecord(also.collection, relatedId)
  await updateRecord(
    also.collection,
    related.id,
    buildPatch(related, also.set, also.increment)
  )
}
