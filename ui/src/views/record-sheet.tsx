import { useState } from "react"
import { Check, Copy } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { runAction } from "@/lib/actions"
import {
  fieldType,
  formatValue,
  type ActionSpec,
  type Collection,
  type ViewSpec,
} from "@/lib/workspace"
import type { PBRecord } from "@/lib/pb"

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  )
}

/**
 * The detail panel for one record: every field in full, long text copyable, and the view's
 * declared actions. This is where the operator actually works — read the drafted message,
 * copy it, send it by hand elsewhere, then mark it.
 */
export function RecordSheet({
  spec,
  collection,
  record,
  onClose,
  onChanged,
}: {
  spec: ViewSpec
  collection: Collection | undefined
  record: PBRecord | null
  onClose: () => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!record) return null

  // Long-form fields get their own block with a copy button; everything else is a row.
  const longFields = new Set(spec.detail ?? [])
  const fields = (collection?.fields ?? []).filter(
    (f) => f.name !== "id" && !["created", "updated"].includes(f.name)
  )

  async function apply(action: ActionSpec) {
    if (!record) return
    setBusy(action.label)
    setError(null)
    try {
      await runAction(spec.collection, record, action)
      onChanged()
      onClose()
    } catch (err: unknown) {
      setError(String(err))
    } finally {
      setBusy(null)
    }
  }

  const title = String(
    record[spec.type === "board" ? spec.card.title : (spec.columns[0] ?? "id")] ?? record.id
  )

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{collection?.label ?? spec.collection}</SheetDescription>
        </SheetHeader>

        {spec.actions?.length ? (
          <>
            <div className="flex flex-wrap gap-2 px-4 pb-4">
              {spec.actions.map((a) => (
                <Button
                  key={a.label}
                  size="sm"
                  variant={a.variant ?? "default"}
                  disabled={busy !== null}
                  onClick={() => apply(a)}
                >
                  {busy === a.label ? "Saving…" : a.label}
                </Button>
              ))}
            </div>
            {error && (
              <div className="px-4 pb-3 text-xs text-destructive">{error}</div>
            )}
            <Separator />
          </>
        ) : null}

        <div className="flex flex-col gap-4 p-4">
          {fields.map((f) => {
            const value = record[f.name]
            const type = fieldType(collection, spec, f.name)
            if (longFields.has(f.name)) {
              const text = String(value ?? "")
              return (
                <div key={f.name} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      {f.label}
                    </span>
                    {text && <CopyButton text={text} />}
                  </div>
                  <div className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">
                    {text || "—"}
                  </div>
                </div>
              )
            }
            return (
              <div key={f.name} className="flex items-baseline justify-between gap-4">
                <span className="text-xs font-medium text-muted-foreground">{f.label}</span>
                <span className="text-right text-sm">
                  {type === "select" && value ? (
                    <Badge variant="secondary">{String(value)}</Badge>
                  ) : (
                    formatValue(type, value)
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}
