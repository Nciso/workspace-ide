import { useState } from "react"
import {
  KanbanSquare,
  Table2,
  Building2,
  FileText,
  Bot,
  Plus,
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { workspace, type ViewSpec } from "@/lib/workspace"
import { TableView } from "@/views/table-view"
import { BoardView } from "@/views/board-view"

const viewIcon: Record<ViewSpec["type"], typeof Table2> = {
  table: Table2,
  board: KanbanSquare,
}

function ViewRenderer({ spec }: { spec: ViewSpec }) {
  if (spec.type === "table") return <TableView spec={spec} />
  if (spec.type === "board") return <BoardView spec={spec} />
  return null
}

export default function App() {
  const [activeId, setActiveId] = useState(workspace.views[0].id)
  const active = workspace.views.find((v) => v.id === activeId)!

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
                const Icon = viewIcon[v.spec.type]
                return (
                  <SidebarMenuItem key={v.id}>
                    <SidebarMenuButton
                      isActive={v.id === activeId}
                      onClick={() => setActiveId(v.id)}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{v.spec.title}</span>
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
                <SidebarMenuButton>
                  <FileText className="h-4 w-4" />
                  <span>README.md</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <Bot className="h-4 w-4" />
                  <span>Connect AI</span>
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
          <h1 className="text-sm font-semibold">{active.spec.title}</h1>
          <Badge variant="secondary" className="ml-1 capitalize">
            {active.spec.type}
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative hidden sm:block">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search…" className="h-8 w-56 pl-8" />
            </div>
            <Button size="sm" className="h-8">
              <Plus className="h-4 w-4" />
              New
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4">
          <ViewRenderer spec={active.spec} />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
