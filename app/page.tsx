'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Bot, CheckCircle2, Clock3, FileSearch, Files, LoaderCircle, MessageSquareText, MoreHorizontal, Plus, Sparkles, Zap } from 'lucide-react'
import { ActionIcon, HutabyteShell, PageHeading } from '@/components/hutabyte-shell'
import { authenticatedFetch } from '@/lib/supabase-browser'

type DashboardData = {
  metrics: {
    documentsAnalyzed: number
    knowledgeSources: number
    questionsAnswered: number
    actionsCompleted: number
  }
  activities: { id: number; type: string; title: string; detail: string; createdAt: string }[]
}

const emptyDashboard: DashboardData = {
  metrics: { documentsAnalyzed: 0, knowledgeSources: 0, questionsAnswered: 0, actionsCompleted: 0 },
  activities: [],
}

const metricDefinitions = [
  { key: 'documentsAnalyzed', label: 'Dokumen dianalisis' },
  { key: 'knowledgeSources', label: 'Sumber pengetahuan' },
  { key: 'questionsAnswered', label: 'Pertanyaan dijawab' },
  { key: 'actionsCompleted', label: 'Tindakan selesai' },
] as const

function activityIcon(type: string) {
  if (type === 'document_analyzed') return FileSearch
  if (type === 'question_answered') return MessageSquareText
  if (type === 'source_synced') return Files
  if (type === 'document_uploaded') return Files
  return CheckCircle2
}

function activityTone(type: string) {
  if (type === 'document_analyzed') return 'indigo'
  if (type === 'question_answered') return 'green'
  if (type === 'source_synced') return 'blue'
  return 'amber'
}

function formatActivityTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default function Page() {
  const [dashboard, setDashboard] = useState(emptyDashboard)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    authenticatedFetch('/api/dashboard', { cache: 'no-store' })
      .then(async response => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || result.error || 'Dashboard tidak dapat dimuat.')
        if (!cancelled) setDashboard(result as DashboardData)
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Dashboard tidak dapat dimuat.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return <HutabyteShell><div className="mx-auto max-w-[1180px] px-5 py-10 sm:px-8 lg:px-12"><PageHeading title="Ruang Kerja AI Anda" description="Ubah pengetahuan perusahaan menjadi jawaban yang jelas, keputusan lebih cepat, dan tindakan yang percaya diri." /><div className="grid gap-4 md:grid-cols-2"><Link href="/assistant" className="group rounded-2xl border border-[#e2e2e7] bg-white p-6 shadow-[0_2px_10px_rgba(20,20,30,0.03)] transition hover:-translate-y-0.5 hover:border-[#c7c9ef] hover:shadow-lg"><div className="mb-8 flex items-start justify-between"><ActionIcon><Bot className="size-5" /></ActionIcon><ArrowUpRight className="size-4 text-[#aaaab1] transition group-hover:text-[#5963dc]" /></div><h2 className="text-lg font-semibold tracking-[-0.025em]">Asisten AI</h2><p className="mt-1.5 max-w-sm text-sm leading-6 text-[#777780]">Ajukan pertanyaan, temukan informasi, dan ubah wawasan menjadi tindakan dari seluruh pengetahuan perusahaan.</p><span className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#5963dc]">Mulai percakapan <ArrowUpRight className="size-3.5" /></span></Link><Link href="/analyzer" className="group rounded-2xl border border-[#e2e2e7] bg-white p-6 shadow-[0_2px_10px_rgba(20,20,30,0.03)] transition hover:-translate-y-0.5 hover:border-[#c7c9ef] hover:shadow-lg"><div className="mb-8 flex items-start justify-between"><ActionIcon tone="green"><FileSearch className="size-5" /></ActionIcon><ArrowUpRight className="size-4 text-[#aaaab1] transition group-hover:text-[#5963dc]" /></div><h2 className="text-lg font-semibold tracking-[-0.025em]">Analisis Dokumen</h2><p className="mt-1.5 max-w-sm text-sm leading-6 text-[#777780]">Ekstrak data penting, temukan risiko, dan dapatkan ringkasan yang dapat ditindaklanjuti dari dokumen bisnis.</p><span className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#5963dc]">Analisis dokumen <ArrowUpRight className="size-3.5" /></span></Link></div>
  <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">{metricDefinitions.map(({ key, label }) => <div key={key} className="rounded-xl border border-[#e7e7eb] bg-white p-4"><p className="text-[11px] text-[#8b8b94]">{label}</p><div className="mt-2 flex items-end justify-between gap-2"><p className="text-2xl font-semibold">{loading ? <LoaderCircle className="size-5 animate-spin" /> : dashboard.metrics[key].toLocaleString('id-ID')}</p></div></div>)}</div>
  {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
  <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]"><section className="rounded-2xl border border-[#e7e7eb] bg-white p-5"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-semibold">Aktivitas terbaru</h2><p className="mt-1 text-xs text-[#92929a]">Aktivitas dari dokumen dan asisten di workspace ini.</p></div><button className="rounded-lg p-2 text-[#92929a] hover:bg-[#f5f5f7]" aria-label="Opsi aktivitas"><MoreHorizontal className="size-4" /></button></div><div className="flex flex-col">{dashboard.activities.length ? dashboard.activities.map(activity => { const Icon = activityIcon(activity.type); const tone = activityTone(activity.type) as 'indigo' | 'green' | 'amber' | 'blue'; return <div key={activity.id} className="flex items-center gap-3 border-t border-[#f0f0f2] py-3.5"><ActionIcon tone={tone}><Icon className="size-4" /></ActionIcon><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{activity.title}</p><p className="mt-0.5 truncate text-xs text-[#92929a]">{activity.detail || formatActivityTime(activity.createdAt)}</p></div><time className="shrink-0 text-[10px] text-[#92929a]">{formatActivityTime(activity.createdAt)}</time></div>}) : <p className="border-t border-[#f0f0f2] py-8 text-center text-xs text-muted-foreground">{loading ? 'Memuat aktivitas...' : 'Belum ada aktivitas. Unggah dokumen, sinkronkan sumber, atau ajukan pertanyaan.'}</p>}</div></section><section className="rounded-2xl bg-[#20206f] p-6 text-white"><div className="mb-10 flex size-10 items-center justify-center rounded-xl bg-white/10"><Zap className="size-5" /></div><h2 className="text-lg font-semibold tracking-[-0.02em]">Gunakan pengetahuan tim Anda.</h2><p className="mt-2 text-sm leading-6 text-indigo-100/75">Hubungkan sumber pengetahuan agar tim dapat menemukan jawaban yang relevan.</p><Link href="/knowledge" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-3.5 py-2.5 text-xs font-semibold text-[#20206f] hover:bg-indigo-50"><Plus className="size-3.5" />Tambah sumber</Link></section></div></div></HutabyteShell>
}
