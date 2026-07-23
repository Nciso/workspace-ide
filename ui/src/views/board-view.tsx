import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  fieldType,
  formatValue,
  type Collection,
  type ViewSpec,
} from "@/lib/workspace"
import type { PBRecord } from "@/lib/pb"

export function BoardView({
  spec,
  collection,
  rows,
  onSelect,
}: {
  spec: Extract<ViewSpec, { type: "board" }>
  collection: Collection | undefined
  rows: PBRecord[]
  onSelect: (record: PBRecord) => void
}) {
  const groupField = collection?.fields.find((f) => f.name === spec.groupBy)
  // One column per option of the grouping field, in the order the schema declares them —
  // so the board reads left-to-right as the lifecycle it models.
  const columns = groupField?.options ?? []
  const badgeName = spec.card.badge
  const badgeType = badgeName ? fieldType(collection, spec, badgeName) : undefined

  if (columns.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <code>{spec.groupBy}</code> is not a select field on{" "}
        <code>{spec.collection}</code>, so this board has no columns to draw.
      </div>
    )
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((col) => {
        const items = rows.filter((r) => r[spec.groupBy] === col)
        const total =
          badgeName && badgeType === "currency"
            ? items.reduce((sum, r) => sum + Number(r[badgeName] ?? 0), 0)
            : null
        return (
          <div key={col} className="flex w-72 shrink-0 flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{col}</span>
                <Badge variant="outline" className="text-muted-foreground">
                  {items.length}
                </Badge>
              </div>
              {total != null && (
                <span className="text-xs text-muted-foreground">
                  {formatValue("currency", total)}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {items.map((item) => (
                <Card
                  key={String(item.id)}
                  onClick={() => onSelect(item)}
                  className="cursor-pointer gap-2 p-3 shadow-sm transition-colors hover:bg-accent"
                >
                  <div className="text-sm font-medium leading-tight">
                    {formatValue("text", item[spec.card.title])}
                  </div>
                  {spec.card.subtitle && item[spec.card.subtitle] ? (
                    <div className="text-xs text-muted-foreground">
                      {String(item[spec.card.subtitle])}
                    </div>
                  ) : null}
                  {badgeName && badgeType !== "currency" && item[badgeName] ? (
                    <div>
                      <Badge variant="secondary">{String(item[badgeName])}</Badge>
                    </div>
                  ) : null}
                  {badgeName && badgeType === "currency" ? (
                    <div className="text-sm font-semibold">
                      {formatValue("currency", item[badgeName])}
                    </div>
                  ) : null}
                </Card>
              ))}
              {items.length === 0 && (
                <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  Empty
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
