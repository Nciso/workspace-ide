// The workspace contract (mock).
//
// In the real runtime these come from the folder: collections from
// pb_migrations, view specs from views/*.yaml, records from PocketBase.
// The UI never hardcodes a schema — it renders whatever the spec describes.

export type FieldType = "text" | "email" | "currency" | "select" | "date"

export interface Field {
  name: string
  label: string
  type: FieldType
  options?: string[] // for select
}

export interface Collection {
  name: string
  label: string
  fields: Field[]
}

// A view is a declarative spec. The renderer is generic; the spec is the product.
export type ViewSpec =
  | {
      type: "table"
      title: string
      collection: string
      columns: string[]
    }
  | {
      type: "board"
      title: string
      collection: string
      groupBy: string // a select field — one column per option
      card: { title: string; subtitle?: string; badge?: string }
    }

export interface Workspace {
  name: string
  collections: Record<string, Collection>
  views: { id: string; spec: ViewSpec }[]
}

const STAGES = ["Lead", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]

export const workspace: Workspace = {
  name: "Sales",
  collections: {
    opportunities: {
      name: "opportunities",
      label: "Opportunities",
      fields: [
        { name: "name", label: "Opportunity", type: "text" },
        { name: "company", label: "Company", type: "text" },
        { name: "value", label: "Value", type: "currency" },
        { name: "stage", label: "Stage", type: "select", options: STAGES },
        { name: "owner", label: "Owner", type: "text" },
        { name: "close_date", label: "Close date", type: "date" },
      ],
    },
    companies: {
      name: "companies",
      label: "Companies",
      fields: [
        { name: "name", label: "Company", type: "text" },
        { name: "industry", label: "Industry", type: "text" },
        { name: "contact", label: "Primary contact", type: "text" },
        { name: "email", label: "Email", type: "email" },
      ],
    },
  },
  views: [
    {
      id: "pipeline",
      spec: {
        type: "board",
        title: "Pipeline",
        collection: "opportunities",
        groupBy: "stage",
        card: { title: "name", subtitle: "company", badge: "value" },
      },
    },
    {
      id: "opportunities",
      spec: {
        type: "table",
        title: "Opportunities",
        collection: "opportunities",
        columns: ["name", "company", "value", "stage", "owner", "close_date"],
      },
    },
    {
      id: "companies",
      spec: {
        type: "table",
        title: "Companies",
        collection: "companies",
        columns: ["name", "industry", "contact", "email"],
      },
    },
  ],
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
    return new Date(String(value)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }
  return String(value)
}
