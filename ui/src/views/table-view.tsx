import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { workspace, formatValue, type ViewSpec } from "@/lib/workspace"
import type { PBRecord } from "@/lib/pb"

export function TableView({
  spec,
  rows,
}: {
  spec: Extract<ViewSpec, { type: "table" }>
  rows: PBRecord[]
}) {
  const collection = workspace.collections[spec.collection]
  const fields = spec.columns.map((c) => collection.fields.find((f) => f.name === c)!)

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {fields.map((f) => (
              <TableHead key={f.name} className="whitespace-nowrap">
                {f.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={String(row.id)}>
              {fields.map((f) => (
                <TableCell key={f.name} className={f.type === "text" ? "font-medium" : ""}>
                  {f.type === "select" ? (
                    <Badge variant="secondary">{String(row[f.name])}</Badge>
                  ) : (
                    formatValue(f.type, row[f.name])
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
