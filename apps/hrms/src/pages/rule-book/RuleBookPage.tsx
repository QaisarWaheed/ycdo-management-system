import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  ExternalLink,
  Search,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  masterFlowMermaid,
  ruleBookCategories,
  type FlowSection,
} from './ruleBookContent'

function FlowSectionCard({ section }: { section: FlowSection }) {
  return (
    <Card id={section.id} className="scroll-mt-24 border-border">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-lg">{section.title}</CardTitle>
          {section.roles && (
            <Badge variant="outline" className="font-normal">
              {section.roles}
            </Badge>
          )}
        </div>
        <p className="text-sm text-text-secondary">{section.summary}</p>
        <p className="text-xs text-text-secondary">
          <span className="font-medium text-text-primary">Where: </span>
          {section.where}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-3">
          {section.steps.map((step, i) => (
            <li key={step.title} className="flex gap-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <div>
                <p className="font-medium text-text-primary">{step.title}</p>
                <p className="mt-0.5 text-text-secondary">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        {section.links && section.links.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {section.links.map((link) => (
              <Button key={link.path} variant="outline" size="sm" asChild>
                <Link to={link.path}>
                  {link.label}
                  <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            ))}
          </div>
        )}

        {section.notes && section.notes.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-950">
            <p className="mb-1 font-medium">Notes</p>
            <ul className="list-inside list-disc space-y-1 text-amber-900/90">
              {section.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MasterFlowDiagram() {
  const nodes = [
    { group: 'Hiring', items: ['Recruitment', 'Add Employee', 'Executive approval (New only)', 'Active employee'] },
    { group: 'Daily', items: ['Check-in / Check-out', 'Auto checkout at shift end', 'Daily log', 'Mark leave + reliever'] },
    { group: 'Leave', items: ['Apply leave', 'Branch → Dept → Reliever → HR Ops', 'ON_LEAVE on attendance', "Today's relievers"] },
    { group: 'Pay & compliance', items: ['Stipend package', 'Monthly payroll', 'Letters', 'Disciplinary'] },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {nodes.map((block, idx) => (
          <div key={block.group} className="relative">
            <Card className="h-full border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-primary">{block.group}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {block.items.map((item, i) => (
                    <li
                      key={item}
                      className="flex items-center gap-2 text-sm text-text-primary"
                    >
                      {i > 0 && (
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
                      )}
                      <span className={i === 0 ? '' : 'flex-1'}>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            {idx < nodes.length - 1 && idx % 2 === 1 && (
              <div className="hidden md:flex absolute -bottom-6 left-1/2 z-10 -translate-x-1/2 text-text-secondary">
                <ArrowRight className="h-5 w-5 rotate-90" />
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-center text-xs text-text-secondary">
        All paths start from an active employee record and connect attendance,
        leave, relievers, and payroll.
      </p>
      <details className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <summary className="cursor-pointer font-medium text-text-primary">
          Full flowchart (reference)
        </summary>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-text-secondary">
          {masterFlowMermaid}
        </pre>
      </details>
    </div>
  )
}

export function RuleBookPage() {
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState('overview')

  const normalizedQuery = query.trim().toLowerCase()

  const filteredCategories = useMemo(() => {
    if (!normalizedQuery) return ruleBookCategories

    return ruleBookCategories
      .map((cat) => ({
        ...cat,
        sections: cat.sections.filter((section) => {
          const blob = [
            cat.label,
            section.title,
            section.summary,
            section.where,
            section.roles ?? '',
            ...section.steps.map((s) => `${s.title} ${s.detail}`),
            ...(section.notes ?? []),
          ]
            .join(' ')
            .toLowerCase()
          return blob.includes(normalizedQuery)
        }),
      }))
      .filter((cat) => cat.sections.length > 0)
  }, [normalizedQuery])

  const defaultTab = filteredCategories[0]?.id ?? 'overview'

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BookOpen className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">
              Rule Book &amp; Flow
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">
              How YCDO HRMS works — module links, approval chains, attendance
              rules, leave &amp; relievers, and role-based access. Use this as
              the system reference for training and daily operations.
            </p>
          </div>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
        <Input
          placeholder="Search flows (e.g. reliever, approval, checkout)..."
          className="pl-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filteredCategories.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-text-secondary">
            No matching flows. Try a different search term.
          </CardContent>
        </Card>
      ) : (
        <Tabs
          value={normalizedQuery ? defaultTab : activeTab}
          onValueChange={setActiveTab}
          className="space-y-4"
        >
          <TabsList className="flex h-auto flex-wrap justify-start gap-1 bg-muted/50 p-1">
            {filteredCategories.map((cat) => (
              <TabsTrigger
                key={cat.id}
                value={cat.id}
                className="text-xs sm:text-sm"
              >
                {cat.label}
                <Badge
                  variant="secondary"
                  className="ml-1.5 h-5 min-w-5 px-1 text-[10px]"
                >
                  {cat.sections.length}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>

          {filteredCategories.map((cat) => (
            <TabsContent key={cat.id} value={cat.id} className="space-y-4">
              {cat.id === 'overview' && (
                <Card className="border-primary/30">
                  <CardHeader>
                    <CardTitle className="text-lg">Master system flow</CardTitle>
                    <p className="text-sm text-text-secondary">
                      High-level view of how hiring, attendance, leave, and
                      payroll connect.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <MasterFlowDiagram />
                  </CardContent>
                </Card>
              )}

              <div className="grid gap-4">
                {cat.sections.map((section) => (
                  <FlowSectionCard key={section.id} section={section} />
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-start gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-text-primary">Quick links</p>
            <p className="text-sm text-text-secondary">
              Jump to the modules referenced in this rule book.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { to: '/employees/new', label: 'Add Employee' },
              { to: '/attendance', label: 'Attendance' },
              { to: '/leave', label: 'Leave' },
              { to: '/payroll', label: 'Payroll' },
              { to: '/reports', label: 'Reports' },
            ].map((item) => (
              <Button key={item.to} variant="outline" size="sm" asChild>
                <Link to={item.to}>
                  {item.label}
                  <ExternalLink className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
