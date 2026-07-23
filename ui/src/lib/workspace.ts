// The workspace contract.
//
// Nothing here is hardcoded per app. Collections come from the engine's /manifest
// (derived from pb_migrations); the views come from the app's own views.json, served on
// that same manifest. The UI renders whatever the app folder describes — which is why one
// embedded bundle can serve every app under apps/.

export type FieldType =
  | "text"
  | "email"
  | "number"
  | "currency"
  | "select"
  | "date"
  | "bool"
  | "relation"
  | "json"

export interface Field {
  name: string
  label: string
  type: FieldType
  options?: string[] // for select — the board builds one column per option
}

export interface Collection {
  name: string
  label: string
  fields: Field[]
}

/**
 * A one-click write, declared rather than coded. `set` values are literals except the
 * token "@now", which becomes the current UTC timestamp; `increment` adds to the record's
 * current number. `also` applies the same kind of patch to the record on the other end of
 * a relation field — so "mark sent" can stamp the message *and* the contact in one click,
 * which is exactly how the agent is told to record a send.
 */
export interface ActionSpec {
  label: string
  set?: Record<string, unknown>
  increment?: Record<string, number>
  also?: {
    via: string // a relation field on this record
    collection: string // what that relation points at
    set?: Record<string, unknown>
    increment?: Record<string, number>
  }
  variant?: "default" | "secondary" | "outline" | "destructive"
}

interface ViewBase {
  id: string
  title: string
  collection: string
  sort?: string
  /** PocketBase filter expression — what this view is *about*, applied server-side. */
  filter?: string
  /** Per-view type overrides, e.g. draw a number field as currency. */
  format?: Record<string, FieldType>
  /** Buttons offered on a record opened from this view. */
  actions?: ActionSpec[]
  /** Fields shown in full (not truncated) when a record is opened. */
  detail?: string[]
}

// A view is a declarative spec. The renderer is generic; the spec is the product.
export type ViewSpec =
  | (ViewBase & { type: "table"; columns: string[] })
  | (ViewBase & {
      type: "board"
      groupBy: string // a select field — one column per option
      card: { title: string; subtitle?: string; badge?: string }
    })

export interface Workspace {
  name: string
  collections: Record<string, Collection>
  views: ViewSpec[]
}

interface ManifestField {
  name: string
  type: string
  values?: string[]
}

interface Manifest {
  name: string
  collections?: { name: string; fields?: ManifestField[] }[]
  views?: ViewSpec[]
}

// PocketBase field types → what the renderer knows how to draw.
const FIELD_TYPES: Record<string, FieldType> = {
  text: "text",
  editor: "text",
  url: "text",
  file: "text",
  email: "email",
  number: "number",
  bool: "bool",
  select: "select",
  date: "date",
  autodate: "date",
  relation: "relation",
  json: "json",
}

function humanize(name: string): string {
  const s = name.replace(/_/g, " ")
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export async function loadWorkspace(): Promise<Workspace> {
  const res = await fetch("/manifest")
  if (!res.ok) throw new Error(`Failed to load manifest: ${res.status}`)
  const manifest: Manifest = await res.json()

  const collections: Record<string, Collection> = {}
  for (const c of manifest.collections ?? []) {
    collections[c.name] = {
      name: c.name,
      label: humanize(c.name),
      fields: (c.fields ?? []).map((f) => ({
        name: f.name,
        label: humanize(f.name),
        type: FIELD_TYPES[f.type] ?? "text",
        options: f.values,
      })),
    }
  }

  // An app with no views.json still renders: one plain table per collection.
  const views: ViewSpec[] = manifest.views?.length
    ? manifest.views
    : Object.values(collections).map((c) => ({
        id: c.name,
        type: "table" as const,
        title: c.label,
        collection: c.name,
        columns: c.fields.slice(0, 6).map((f) => f.name),
      }))

  return { name: manifest.name, collections, views }
}

/** The type a view wants a field drawn as, honouring the spec's `format` override. */
export function fieldType(
  collection: Collection | undefined,
  spec: ViewSpec,
  name: string
): FieldType {
  return (
    spec.format?.[name] ??
    collection?.fields.find((f) => f.name === name)?.type ??
    "text"
  )
}

export function fieldLabel(collection: Collection | undefined, name: string): string {
  return collection?.fields.find((f) => f.name === name)?.label ?? humanize(name)
}

export function formatValue(type: FieldType, value: unknown): string {
  if (value == null || value === "") return "—"
  if (type === "currency") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Number(value))
  }
  if (type === "date") {
    const d = new Date(String(value))
    if (Number.isNaN(d.getTime())) return String(value)
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }
  if (type === "bool") return value ? "Yes" : "No"
  return String(value)
}
