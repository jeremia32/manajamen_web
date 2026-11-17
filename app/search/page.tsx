'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, FileText, LayoutDashboard, Search as SearchIcon } from 'lucide-react'
import { Suspense, useEffect, useState, type FormEvent } from 'react'
import { HutabyteShell, PageHeading } from '@/components/hutabyte-shell'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { authenticatedFetch, readApiResponse } from '@/lib/supabase-browser'

type ResultType = 'page' | 'document' | 'meeting'
type SearchResult = { type: ResultType; id: string; title: string; source: string; snippet: string; href: string }
type SearchResponse = { results: SearchResult[]; warnings?: string[] }
type Filter = 'all' | ResultType

const categories: { type: ResultType; label: string; icon: typeof LayoutDashboard }[] = [
	{ type: 'page', label: 'Halaman', icon: LayoutDashboard },
	{ type: 'document', label: 'Dokumen', icon: FileText },
	{ type: 'meeting', label: 'Meeting', icon: CalendarDays },
]

function SearchContent() {
	const params = useSearchParams()
	const router = useRouter()
	const query = params.get('q') ?? ''
	const [term, setTerm] = useState(query)
	const [results, setResults] = useState<SearchResult[]>([])
	const [filter, setFilter] = useState<Filter>('all')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')
	const [warnings, setWarnings] = useState<string[]>([])

	useEffect(() => {
		setTerm(query)
		setError('')
		setWarnings([])
		if (!query.trim()) {
			setResults([])
			setLoading(false)
			return
		}

		let active = true
		const controller = new AbortController()
		setLoading(true)
		void authenticatedFetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
			.then(response => readApiResponse<SearchResponse>(response, 'Pencarian gagal dimuat.'))
			.then(data => {
				if (active) {
					setResults(data.results ?? [])
					setWarnings(data.warnings ?? [])
				}
			})
			.catch(cause => {
				if (active && !controller.signal.aborted) {
					setResults([])
					setWarnings([])
					setError(cause instanceof Error ? cause.message : 'Pencarian gagal dimuat.')
				}
			})
			.finally(() => { if (active) setLoading(false) })

		return () => {
			active = false
			controller.abort()
		}
	}, [query])

	function submitSearch(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const value = term.trim()
		router.replace(value ? `/search?q=${encodeURIComponent(value)}` : '/search')
	}

	const visibleGroups = categories
		.filter(category => filter === 'all' || filter === category.type)
		.map(category => ({
			...category,
			items: results.filter(result => result.type === category.type),
		}))
		.filter(category => category.items.length > 0)

	return (
		<HutabyteShell>
			<div className="mx-auto max-w-5xl px-6 py-10">
				<PageHeading
					eyebrow="Pencarian global"
					title={query ? `Hasil pencarian untuk “${query}”` : 'Cari di seluruh workspace'}
					description="Temukan halaman, dokumen, dan meeting yang dapat Anda akses."
				/>
				<form onSubmit={submitSearch} className="mb-6 flex max-w-2xl gap-2">
					<div className="relative min-w-0 flex-1">
						<SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={term}
							onChange={event => setTerm(event.target.value)}
							placeholder="Cari halaman, dokumen, atau meeting..."
							className="pl-9"
							aria-label="Cari halaman, dokumen, atau meeting"
						/>
					</div>
					<button type="submit" className="rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90">
						Cari
					</button>
				</form>

				{warnings.length > 0 && (
					<div role="status" className="mb-6 grid gap-2">
						{warnings.map(warning => (
							<p key={warning} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
								{warning}
							</p>
						))}
					</div>
				)}

				<div className="mb-6 flex flex-wrap gap-2">
					<button
						type="button"
						onClick={() => setFilter('all')}
						className={`rounded-full border px-3 py-1.5 text-xs ${filter === 'all' ? 'bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted'}`}
					>
						Semua ({results.length})
					</button>
					{categories.map(category => {
						const count = results.filter(result => result.type === category.type).length
						return (
							<button
								key={category.type}
								type="button"
								onClick={() => setFilter(category.type)}
								className={`rounded-full border px-3 py-1.5 text-xs ${filter === category.type ? 'bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted'}`}
							>
								{category.label} ({count})
							</button>
						)
					})}
				</div>

				{error ? (
					<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>
				) : loading ? (
					<p role="status" className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Mencari di halaman, dokumen, dan meeting...</p>
				) : !query.trim() ? (
					<div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Masukkan kata kunci untuk mulai mencari.</div>
				) : !visibleGroups.length ? (
					<div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Tidak ada hasil untuk &apos;{query}&apos;.</div>
				) : (
					<div className="flex flex-col gap-8">
						{visibleGroups.map(group => {
							const Icon = group.icon
							return (
								<section key={group.type} aria-labelledby={`search-${group.type}`}>
									<div className="mb-3 flex items-center gap-2">
										<Icon className="size-4 text-primary" />
										<h2 id={`search-${group.type}`} className="text-sm font-semibold">{group.label}</h2>
										<span className="text-xs text-muted-foreground">{group.items.length}</span>
									</div>
									<div className="grid gap-3">
										{group.items.map(item => (
											<Link
												href={item.href}
												key={`${item.type}-${item.id}`}
												className="group rounded-xl border border-border bg-card p-4 transition hover:border-primary/40 hover:bg-accent/50 hover:shadow-sm"
											>
												<div className="flex items-start justify-between gap-3">
													<div className="min-w-0">
														<h3 className="truncate text-sm font-medium group-hover:text-primary">{item.title}</h3>
														<p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{item.snippet}</p>
													</div>
													<Badge variant="secondary" className="shrink-0">{item.source}</Badge>
												</div>
											</Link>
										))}
									</div>
								</section>
							)
						})}
					</div>
				)}
			</div>
		</HutabyteShell>
	)
}

export default function SearchPage() {
	return (
		<Suspense fallback={<HutabyteShell><div className="p-10 text-muted-foreground">Pencarian sedang dimuat...</div></HutabyteShell>}>
			<SearchContent />
		</Suspense>
	)
}
