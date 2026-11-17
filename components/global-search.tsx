'use client'

import { CalendarDays, LayoutDashboard, Search, X, FileText } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Skeleton } from '@/components/ui/skeleton'
import { authenticatedFetch, readApiResponse } from '@/lib/supabase-browser'

type ResultType = 'page' | 'document' | 'meeting'
type Result = { type: ResultType; id: string; title: string; source: string; snippet: string; href: string }
type SearchResponse = { results: Result[]; warnings?: string[] }

const groups: { type: ResultType; label: string; icon: typeof LayoutDashboard }[] = [
  { type: 'page', label: 'Halaman', icon: LayoutDashboard },
  { type: 'document', label: 'Dokumen', icon: FileText },
  { type: 'meeting', label: 'Meeting', icon: CalendarDays },
]

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'))
  return (
    <>
      {parts.map((part, index) => part.toLowerCase() === query.toLowerCase()
        ? <mark key={index} className="rounded bg-primary/20 px-0.5 text-inherit">{part}</mark>
        : part)}
    </>
  )
}

export function GlobalSearch() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [warning, setWarning] = useState('')
  const [selected, setSelected] = useState(0)
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('hutabyte-recent-searches') || '[]')
      if (Array.isArray(saved)) setRecent(saved.filter((item): item is string => typeof item === 'string').slice(0, 5))
    } catch {
      console.warn('Recent searches could not be loaded from local storage.')
    }
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setLoading(false)
      setError(false)
      setWarning('')
      return
    }

    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError(false)
      setWarning('')
      try {
        const response = await authenticatedFetch(
          `/api/search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        )
        const data = await readApiResponse<SearchResponse>(response, 'Pencarian gagal dimuat.')
        if (active) {
          setResults(data.results ?? [])
          setWarning(data.warnings?.[0] ?? '')
          setSelected(0)
        }
      } catch {
        if (active && !controller.signal.aborted) {
          setError(true)
          setWarning('')
        }
      } finally {
        if (active) setLoading(false)
      }
    }, 300)

    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const openResult = (result?: Result) => {
    const href = result?.href || `/search?q=${encodeURIComponent(query)}`
    if (query.trim()) {
      try {
        const next = [query, ...recent.filter(item => item !== query)].slice(0, 5)
        localStorage.setItem('hutabyte-recent-searches', JSON.stringify(next))
      } catch {
        console.warn('Recent search could not be saved to local storage.')
      }
    }
    setOpen(false)
    router.push(href)
  }

  const resultGroups = groups
    .map(group => ({ ...group, items: results.filter(item => item.type === group.type) }))
    .filter(group => group.items.length)

  return (
    <div className="relative hidden w-[min(42vw,360px)] md:block">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground focus-within:border-primary">
        <Search className="size-3.5 shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSelected(value => Math.min(value + 1, Math.max(results.length - 1, 0)))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSelected(value => Math.max(value - 1, 0))
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              openResult(results[selected])
            }
            if (event.key === 'Escape') setOpen(false)
          }}
          placeholder="Cari halaman, dokumen, atau meeting..."
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          aria-label="Cari halaman, dokumen, atau meeting"
        />
        {query
          ? <button type="button" onClick={() => setQuery('')} aria-label="Hapus pencarian"><X className="size-3.5" /></button>
          : <kbd className="hidden rounded border border-border bg-background px-1.5 py-0.5 text-[10px] sm:inline">Ctrl K</kbd>}
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
          <Command shouldFilter={false}>
            <CommandList>
              {loading ? (
                <div className="flex flex-col gap-2 p-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
              ) : error ? (
                <CommandEmpty>
                  <button type="button" onClick={() => setQuery(value => `${value} `)} className="text-primary">Gagal memuat hasil. Coba lagi.</button>
                </CommandEmpty>
              ) : !query.trim() ? (
                <CommandGroup heading="Pencarian terbaru">
                  {recent.length
                    ? recent.map(item => <CommandItem key={item} onSelect={() => setQuery(item)}>{item}</CommandItem>)
                    : <CommandEmpty>Belum ada pencarian terbaru.</CommandEmpty>}
                </CommandGroup>
              ) : !results.length ? (
                <CommandEmpty>Tidak ada hasil untuk &apos;{query}&apos;</CommandEmpty>
              ) : (
                resultGroups.map(group => (
                  <CommandGroup key={group.type} heading={group.label}>
                    {group.items.map(item => {
                      const index = results.indexOf(item)
                      const Icon = group.icon
                      return (
                        <CommandItem
                          key={`${item.type}-${item.id}`}
                          value={`${item.type}-${item.id}`}
                          onSelect={() => openResult(item)}
                          className={index === selected ? 'bg-accent' : ''}
                        >
                          <Icon className="mr-2 size-4 shrink-0" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium"><Highlight text={item.title} query={query} /></span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              <span className="mr-1 rounded bg-muted px-1.5 py-0.5">{item.source}</span>
                              <Highlight text={item.snippet} query={query} />
                            </span>
                          </span>
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                ))
              )}
            </CommandList>
          </Command>
          {warning && <p role="status" className="border-t border-border px-3 py-2 text-[11px] text-amber-800">{warning}</p>}
        </div>
      )}
    </div>
  )
}
