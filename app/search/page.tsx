'use client'

import { HutabyteShell, PageHeading } from '@/components/hutabyte-shell'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { useEffect, useState } from 'react'
import { authenticatedFetch } from '@/lib/supabase-browser'

function SearchContent() {
	const params = useSearchParams()
	const query = params.get('q') ?? ''
	const [results, setResults] = useState<any[]>([])
	const [filter, setFilter] = useState('Semua')
	const [error, setError] = useState('')

	useEffect(() => {
		let cancelled = false
		setError('')
		void authenticatedFetch(`/api/search?q=${encodeURIComponent(query)}`)
			.then(async response => {
				const data = await response.json()
				if (!response.ok) throw new Error(data.detail || data.error || 'Pencarian gagal dimuat.')
				if (!cancelled) setResults(data.results ?? [])
			})
			.catch(cause => {
				if (!cancelled) {
					setResults([])
					setError(cause instanceof Error ? cause.message : 'Pencarian gagal dimuat.')
				}
			})
		return () => { cancelled = true }
	}, [query])

	const visible = filter === 'Semua' ? results : results.filter(item => item.type === filter)

	return (
		<HutabyteShell>
			<div className="mx-auto max-w-5xl px-6 py-10">
				<PageHeading eyebrow="Pencarian global" title={`Hasil pencarian untuk “${query}”`} description="Cari dokumen, analisis, dan percakapan di seluruh ruang kerja Anda." />
				<Input defaultValue={query} placeholder="Cari dokumen..." className="mb-6 max-w-xl" />
				<div className="mb-6 flex gap-2">
					{['Semua', 'document', 'analysis', 'conversation'].map(item => (
						<button key={item} onClick={() => setFilter(item)} className={`rounded-full border px-3 py-1.5 text-xs ${filter === item ? 'bg-primary text-primary-foreground' : 'border-border text-muted-foreground'}`}>
							{item === 'Semua' ? item : item === 'document' ? 'Dokumen' : item === 'analysis' ? 'Hasil Analisis' : 'Percakapan'}
						</button>
					))}
				</div>
				<div className="flex flex-col gap-3">
					{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : visible.map(item => (
						<a href={item.href} key={`${item.type}-${item.id}`} className="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent">
							<div className="flex items-center justify-between gap-3"><h2 className="font-medium">{item.title}</h2><Badge variant="secondary">{item.source}</Badge></div>
							<p className="mt-2 text-sm text-muted-foreground">{item.snippet}</p>
						</a>
					))}
					{!error && !visible.length && <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Tidak ada hasil untuk &apos;{query}&apos;</div>}
				</div>
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
