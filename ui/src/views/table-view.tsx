import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  fieldLabel,
  fieldType,
  formatValue,
  type Collection,
  type ViewSpec,
} from "@/lib/workspace"
import type { PBRecord } from "@/lib/pb"

export function TableView({
  spec,
  collection,
  rows,
  onSelect,
}: {
  spec: Extract<ViewSpec, { type: "table" }>
  collection: Collection | undefined
  rows: PBRecord[]
  onSelect: (record: PBRecord) => void
}) {
  const columns = spec.columns.map((name) => ({
    name,
    label: fieldLabel(collection, name),
    type: fieldType(collection, spec, name),
  }))

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.name} className="whitespace-nowrap">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={String(row.id)}
              onClick={() => onSelect(row)}
              className="cursor-pointer"
            >
              {columns.map((c) => (
                <TableCell key={c.name} className={c.type === "text" ? "font-medium" : ""}>
                  {c.type === "select" && row[c.name] ? (
                    <Badge variant="secondary">{String(row[c.name])}</Badge>
                  ) : (
                    formatValue(c.type, row[c.name])
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-sm text-muted-foreground"
              >
                Nothing here yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
