import { useEffect, useMemo, useState } from "react"
import {
  KanbanSquare,
  Table2,
  Building2,
  FileText,
  Bot,
  Search,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { loadWorkspace, type ViewSpec, type Workspace } from "@/lib/workspace"
import { useRecords } from "@/lib/use-records"
import type { PBRecord } from "@/lib/pb"
import { TableView } from "@/views/table-view"
import { BoardView } from "@/views/board-view"
import { RecordSheet } from "@/views/record-sheet"

const viewIcon: Record<ViewSpec["type"], typeof Table2> = {
  table: Table2,
  board: KanbanSquare,
}

function ViewRenderer({
  workspace,
  spec,
  query,
}: {
  workspace: Workspace
  spec: ViewSpec
  query: string
}) {
  const { records, loading, error, reload } = useRecords(
    spec.collection,
    spec.sort,
    spec.filter
  )
  const [selected, setSelected] = useState<PBRecord | null>(null)
  const collection = workspace.collections[spec.collection]

  // Search filters what is already on screen — no server round-trip, no index needed.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return records
    return records.filter((r) =>
      Object.entries(r).some(
        ([k, v]) =>
          !k.startsWith("collection") &&
          String(v ?? "").toLowerCase().includes(q)
      )
    )
  }, [records, query])

  if (loading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
  }
  if (error) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        {error}
      </div>
    )
  }
  return (
    <>
      {spec.type === "table" ? (
        <TableView
          spec={spec}
          collection={collection}
          rows={rows}
          onSelect={setSelected}
        />
      ) : (
        <BoardView
          spec={spec}
          collection={collection}
          rows={rows}
          onSelect={setSelected}
        />
      )}
      <RecordSheet
        spec={spec}
        collection={collection}
        record={selected}
        onClose={() => setSelected(null)}
        onChanged={reload}
      />
    </>
  )
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  useEffect(() => {
    loadWorkspace()
      .then((ws) => {
        setWorkspace(ws)
        setActiveId(ws.views[0]?.id ?? null)
      })
      .catch((err: unknown) => setLoadError(String(err)))
  }, [])

  if (loadError) {
    return (
      <div className="flex h-screen items-center justify-center p-8 text-center text-sm text-muted-foreground">
        {loadError}
      </div>
    )
  }
  if (!workspace) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Loading workspace…
      </div>
    )
  }

  const active = workspace.views.find((v) => v.id === activeId) ?? workspace.views[0]

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Building2 className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold leading-none">{workspace.name}</span>
              <span className="text-xs text-muted-foreground">Workspace</span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Views</SidebarGroupLabel>
            <SidebarMenu>
              {workspace.views.map((v) => {
                const Icon = viewIcon[v.type]
                return (
                  <SidebarMenuItem key={v.id}>
                    <SidebarMenuButton
                      isActive={v.id === active?.id}
                      onClick={() => setActiveId(v.id)}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{v.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => window.open("/_/", "_blank")}>
                  <FileText className="h-4 w-4" />
                  <span>Admin</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => window.open("/agent/tools", "_blank")}>
                  <Bot className="h-4 w-4" />
                  <span>Agent tools</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-1 h-5" />
          <h1 className="text-sm font-semibold">{active?.title ?? "Workspace"}</h1>
          {active && (
            <Badge variant="secondary" className="ml-1 capitalize">
              {active.type}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
            <div className="relative hidden sm:block">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 w-56 pl-8"
              />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4">
          {active ? (
            <ViewRenderer workspace={workspace} spec={active} query={query} />
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              This app has no views yet. Add a <code>views.json</code> to its folder.
            </div>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
