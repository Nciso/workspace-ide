import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { workspace, formatValue, type ViewSpec } from "@/lib/workspace"
import type { PBRecord } from "@/lib/pb"

export function BoardView({
  spec,
  rows,
}: {
  spec: Extract<ViewSpec, { type: "board" }>
  rows: PBRecord[]
}) {
  const collection = workspace.collections[spec.collection]
  const groupField = collection.fields.find((f) => f.name === spec.groupBy)!
  const columns = groupField.options ?? []
  const badgeField = spec.card.badge
    ? collection.fields.find((f) => f.name === spec.card.badge)!
    : undefined

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((col) => {
        const items = rows.filter((r) => r[spec.groupBy] === col)
        const total = badgeField?.type === "currency"
          ? items.reduce((sum, r) => sum + Number(r[badgeField.name] ?? 0), 0)
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
                <Card key={String(item.id)} className="gap-2 p-3 shadow-sm">
                  <div className="text-sm font-medium leading-tight">
                    {String(item[spec.card.title])}
                  </div>
                  {spec.card.subtitle && (
                    <div className="text-xs text-muted-foreground">
                      {String(item[spec.card.subtitle])}
                    </div>
                  )}
                  {badgeField && (
                    <div className="text-sm font-semibold">
                      {formatValue(badgeField.type, item[badgeField.name])}
                    </div>
                  )}
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
