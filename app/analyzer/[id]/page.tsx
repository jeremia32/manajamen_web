'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { AlertCircle, ArrowLeft, ArrowUp, Check, Clipboard, Download, FileText, LoaderCircle, RefreshCw, ShieldAlert, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { HutabyteShell } from '@/components/hutabyte-shell'
import type { AnalysisResponse, DocumentRecord } from '@/lib/types'
import { authenticatedFetch } from '@/lib/supabase-browser'

type AnalyzerTab = 'fields' | 'summary' | 'questions'
type DocumentQuestion = { question: string; answer: string; sources?: { documentName: string; page: number; snippet: string }[]; error?: boolean }

const supportedExtensions = /\.(pdf|docx|txt|md)$/i
const maxUploadBytes = 50 * 1024 * 1024

function formatLabel(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, character => character.toUpperCase())
}

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [document, setDocument] = useState<DocumentRecord | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null)
  const [tab, setTab] = useState<AnalyzerTab>('fields')
  const [loadingDocument, setLoadingDocument] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [questions, setQuestions] = useState<DocumentQuestion[]>([])

  async function runAnalysis(documentId: string) {
    setAnalyzing(true)
    setError('')
    try {
      const response = await authenticatedFetch(`/api/documents/${documentId}/analyze`, { method: 'POST' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || result.error || 'Analisis dokumen gagal.')
      setAnalysis(result as AnalysisResponse)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Analisis tidak dapat dijalankan.')
    } finally {
      setAnalyzing(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function loadDocument() {
      setLoadingDocument(true)
      setAnalysis(null)
      setQuestions([])
      setError('')
      if (id === 'enterprise-agreement') {
        setDocument(null)
        setLoadingDocument(false)
        return
      }
      try {
        const response = await authenticatedFetch('/api/documents')
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || result.error || 'Daftar dokumen tidak dapat dimuat.')
        const records = (result.documents ?? []) as DocumentRecord[]
        const current = records.find(item => item.id === id)
        if (!current) throw new Error('Dokumen tidak ditemukan. Unggah file terlebih dahulu dari halaman Analisis Dokumen.')
        if (cancelled) return
        setDocument(current)
        setLoadingDocument(false)
        if (current.status.toLowerCase() !== 'indexed') {
          setError('Dokumen belum selesai diindeks. Tunggu proses upload selesai lalu jalankan analisis kembali.')
          return
        }
        await runAnalysis(id)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Dokumen tidak dapat dimuat.')
      } finally {
        if (!cancelled) setLoadingDocument(false)
      }
    }
    void loadDocument()
    return () => { cancelled = true }
  }, [id])

  async function uploadReplacement(file?: File) {
    if (!file || uploading) return
    if (!supportedExtensions.test(file.name)) {
      toast.error('Format yang didukung: PDF, DOCX, TXT, dan MD.')
      return
    }
    if (file.size > maxUploadBytes) {
      toast.error('Ukuran file maksimum 50 MB.')
      return
    }
    setUploading(true)
    try {
      const formData = new FormData()
      formData.set('file', file)
      const response = await authenticatedFetch('/api/documents', { method: 'POST', body: formData })
      const result = await response.json()
      if (!response.ok || !result.documentId) throw new Error(result.detail || result.error || 'File gagal diunggah.')
      router.replace(`/analyzer/${result.documentId}`)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Tidak dapat mengunggah file.')
    } finally {
      setUploading(false)
    }
  }

  async function askQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submittedQuestion = question.trim()
    if (!submittedQuestion || asking || !document) return
    setQuestion('')
    setAsking(true)
    try {
      const response = await authenticatedFetch(`/api/documents/${document.id}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: submittedQuestion, language: 'id' }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || result.error || 'Pertanyaan gagal dijawab.')
      setQuestions(current => [...current, { question: submittedQuestion, answer: result.answer, sources: result.sources ?? [] }])
    } catch (cause) {
      setQuestions(current => [...current, {
        question: submittedQuestion,
        answer: cause instanceof Error ? cause.message : 'Tidak dapat terhubung ke backend AI.',
        error: true,
      }])
    } finally {
      setAsking(false)
    }
  }

  async function copySummary() {
    if (!analysis) return
    const text = `${analysis.summary}\n\nRisiko:\n${analysis.risks.map(risk => `- ${risk.title} (${risk.severity}): ${risk.detail}`).join('\n')}`
    await navigator.clipboard.writeText(text)
    toast.success('Ringkasan disalin.')
  }

  function exportAnalysis() {
    if (!analysis || !document) return
    const blob = new Blob([JSON.stringify({ document: document.name, ...analysis }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = `${document.name.replace(/\.[^.]+$/, '')}-analysis.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const hasDocument = Boolean(document)

  return (
    <HutabyteShell>
      <div className="min-h-[calc(100vh-58px)]">
        <div className="flex items-center justify-between border-b border-[#e8e8eb] bg-white px-5 py-3">
          <Link href="/analyzer" className="flex items-center gap-2 text-xs font-medium text-[#777780]"><ArrowLeft className="size-3.5" />Semua analisis</Link>
          <div className="flex items-center gap-2">
            <button type="button" onClick={exportAnalysis} disabled={!analysis} className="flex items-center gap-2 rounded-lg border border-[#dedee4] px-3 py-2 text-xs disabled:opacity-50"><Download className="size-3.5" />Ekspor</button>
            <button type="button" onClick={() => document && void runAnalysis(document.id)} disabled={!document || analyzing} className="flex items-center gap-2 rounded-lg bg-[#17171b] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{analyzing ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}Analisis ulang</button>
          </div>
        </div>

        {!hasDocument && !loadingDocument ? (
          <div className="mx-auto max-w-2xl px-5 py-16 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-[#f0f0ff] text-[#5963dc]"><FileText className="size-5" /></div>
            <h1 className="mt-5 text-xl font-semibold">Pilih dokumen untuk dianalisis</h1>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">Belum ada file pada halaman ini. Unggah dokumen untuk mengekstrak informasi, membuat ringkasan, dan memeriksa risiko.</p>
            <input ref={fileInput} type="file" accept=".pdf,.docx,.txt,.md" className="sr-only" onChange={event => { void uploadReplacement(event.target.files?.[0]); event.currentTarget.value = '' }} />
            <div role="button" tabIndex={0} onClick={() => fileInput.current?.click()} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.current?.click() } }} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void uploadReplacement(event.dataTransfer.files[0]) }} className={`mt-7 flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-5 py-8 transition ${dragging ? 'border-primary bg-primary/5' : 'border-border bg-white hover:border-primary'}`}>
              {uploading ? <LoaderCircle className="size-6 animate-spin text-primary" /> : <Upload className="size-6 text-primary" />}
              <span className="mt-3 text-sm font-semibold">{uploading ? 'Mengunggah dan mengindeks...' : 'Pilih file dari komputer atau tarik ke sini'}</span>
              <span className="mt-1 text-xs text-muted-foreground">PDF, DOCX, TXT, atau MD · maksimal 50 MB</span>
              <span className="mt-4 rounded-md bg-[#17171b] px-4 py-2 text-xs font-semibold text-white">Pilih File</span>
            </div>
            {error && <p role="alert" className="mt-4 text-xs text-red-700">{error}</p>}
          </div>
        ) : (
          <div className="grid lg:min-h-[calc(100vh-112px)] lg:grid-cols-[38%_62%]">
            <section className="border-b border-[#e8e8eb] bg-[#f5f5f7] p-5 sm:p-7 lg:border-b-0 lg:border-r">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white"><FileText className="size-5 text-[#5963dc]" /></span>
                  <div className="min-w-0"><p className="truncate text-sm font-semibold">{loadingDocument ? 'Memuat dokumen...' : document?.name}</p><p className="mt-1 text-xs text-muted-foreground">{document?.type} · {document?.size}</p></div>
                </div>
                <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} aria-label="Ganti dokumen" title="Ganti dokumen" className="shrink-0 rounded-lg border bg-white p-2 text-muted-foreground hover:text-foreground disabled:opacity-50">{uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}</button>
                <input ref={fileInput} type="file" accept=".pdf,.docx,.txt,.md" className="sr-only" onChange={event => { void uploadReplacement(event.target.files?.[0]); event.currentTarget.value = '' }} />
              </div>
              <div className="mt-6 flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-[#d5d5dc] bg-white px-6 py-8 text-center sm:min-h-72">
                {loadingDocument || analyzing ? <LoaderCircle className="size-6 animate-spin text-[#5963dc]" /> : error ? <AlertCircle className="size-6 text-amber-600" /> : <Check className="size-6 text-emerald-600" />}
                <p className="mt-3 text-sm font-semibold">{analyzing ? 'Menganalisis dokumen' : analysis ? 'Dokumen siap ditinjau' : loadingDocument ? 'Memuat file' : 'Status dokumen'}</p>
                <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{error || (analysis ? 'File tersimpan dan teksnya sudah dianalisis. Pratinjau visual file tersedia pada penyimpanan dokumen.' : 'Ekstraksi teks, ringkasan, dan pemeriksaan risiko sedang diproses.')}</p>
              </div>
            </section>

            <section className="bg-white p-5 sm:p-8">
              <div className="mx-auto max-w-3xl">
                <div className="mb-6">
                  <p className="text-[10px] font-semibold uppercase tracking-[.12em] text-[#5963dc]">{analyzing ? 'Analisis berjalan' : analysis ? 'Analisis selesai' : 'Analisis dokumen'}</p>
                  <h1 className="mt-1 break-words text-xl font-semibold">{document?.name ?? 'Dokumen'}</h1>
                  <p className="mt-1 text-xs text-[#92929a]">{document?.type} · {document?.createdAt ? new Date(document.createdAt).toLocaleString('id-ID') : 'Dokumen Anda'}</p>
                </div>

                <div className="mb-5 grid grid-cols-3 gap-1 rounded-lg bg-[#f4f4f6] p-1" role="tablist" aria-label="Hasil analisis">
                  {([['fields', 'Data ekstraksi'], ['summary', 'Ringkasan & risiko'], ['questions', 'Tanya dokumen']] as const).map(([value, label]) => (
                    <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`rounded-md px-2 py-2 text-xs transition ${tab === value ? 'bg-white font-semibold shadow-sm' : 'text-[#777780] hover:text-foreground'}`}>{label}</button>
                  ))}
                </div>

                {error && <div role="alert" className="mb-5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</div>}

                {tab === 'fields' && (
                  <div className="rounded-xl border border-[#e5e5ea]">
                    <div className="flex items-center justify-between border-b border-[#eeeeef] p-4"><h2 className="text-sm font-semibold">Informasi yang diekstrak</h2>{analysis && <span className="flex items-center gap-1 text-[10px] text-[#3c986c]"><Check className="size-3" />Dari dokumen</span>}</div>
                    {!analysis ? <p className="p-5 text-sm text-muted-foreground">{analyzing ? 'Data sedang diekstrak...' : 'Belum ada data ekstraksi untuk ditampilkan.'}</p> : Object.entries(analysis.extractedFields).length === 0 ? <p className="p-5 text-sm text-muted-foreground">Tidak ada data terstruktur yang berhasil diekstrak.</p> : Object.entries(analysis.extractedFields).map(([label, value]) => (
                      <div key={label} className="grid gap-1 border-b border-[#f0f0f2] p-4 last:border-0 sm:grid-cols-[150px_1fr] sm:items-start sm:gap-4"><span className="text-xs text-[#888891]">{formatLabel(label)}</span><span className="whitespace-pre-wrap text-xs font-medium">{value}</span></div>
                    ))}
                  </div>
                )}

                {tab === 'summary' && (
                  <div className="flex flex-col gap-4">
                    <section className="rounded-xl border p-4"><h2 className="text-sm font-semibold">Ringkasan</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#55555f]">{analysis?.summary || (analyzing ? 'Ringkasan sedang dibuat...' : 'Ringkasan belum tersedia.')}</p></section>
                    <section className="rounded-xl border border-[#eadfc8] bg-[#fffaf0] p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="size-4 text-[#c68c27]" />Risiko dan hal yang perlu ditinjau</div>
                      {!analysis?.risks.length ? <p className="mt-3 text-xs leading-5 text-[#777780]">{analyzing ? 'Risiko sedang diperiksa...' : 'Tidak ada risiko yang dikembalikan oleh analisis.'}</p> : <div className="mt-3 flex flex-col gap-3">{analysis.risks.map((risk, index) => <article key={`${risk.title}-${index}`} className="rounded-lg border border-[#eadfc8] bg-white/70 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-semibold">{risk.title}</h3><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${risk.severity === 'High' ? 'bg-red-100 text-red-800' : risk.severity === 'Medium' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{risk.severity}</span></div><p className="mt-2 text-xs leading-5 text-[#777780]">{risk.detail}</p></article>)}</div>}
                    </section>
                    <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void copySummary()} disabled={!analysis} className="flex items-center gap-2 rounded-lg border border-[#dedee4] px-3 py-2 text-xs disabled:opacity-50"><Clipboard className="size-3.5" />Salin ringkasan</button><button type="button" onClick={exportAnalysis} disabled={!analysis} className="flex items-center gap-2 rounded-lg border border-[#dedee4] px-3 py-2 text-xs disabled:opacity-50"><Download className="size-3.5" />Ekspor JSON</button></div>
                  </div>
                )}

                {tab === 'questions' && (
                  <div className="flex min-h-[360px] flex-col rounded-xl border">
                    <div className="border-b p-4"><h2 className="text-sm font-semibold">Tanya dokumen ini</h2><p className="mt-1 text-xs text-muted-foreground">Jawaban dibatasi pada isi dokumen yang sedang dianalisis.</p></div>
                    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
                      {!questions.length && <p className="m-auto max-w-sm text-center text-xs leading-5 text-muted-foreground">Contoh: “Apa kewajiban utama para pihak?” atau “Kapan kontrak ini berakhir?”</p>}
                      {questions.map((item, index) => <div key={`${item.question}-${index}`} className="flex flex-col gap-2"><p className="self-end rounded-xl rounded-br-sm bg-[#5963dc] px-3 py-2 text-xs text-white">{item.question}</p><div className={`self-start rounded-xl rounded-tl-sm border px-3 py-2 text-xs leading-5 ${item.error ? 'border-red-200 bg-red-50 text-red-800' : 'bg-[#fafafa] text-[#55555f]'}`}><p className="whitespace-pre-wrap">{item.answer}</p>{!!item.sources?.length && <div className="mt-3 border-t pt-2"><p className="mb-1 font-semibold">Sumber dokumen</p>{item.sources.map((source, sourceIndex) => <p key={`${source.documentName}-${sourceIndex}`} className="text-[10px] text-muted-foreground">{source.documentName}{source.page ? ` · halaman ${source.page}` : ''}</p>)}</div>}</div></div>)}
                      {asking && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Mencari jawaban di dokumen...</p>}
                    </div>
                    <form onSubmit={askQuestion} className="flex gap-2 border-t p-3"><input value={question} onChange={event => setQuestion(event.target.value)} disabled={!document || asking} placeholder="Tulis pertanyaan tentang dokumen..." aria-label="Pertanyaan tentang dokumen" className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" /><button type="submit" disabled={!question.trim() || asking || !document} aria-label="Kirim pertanyaan" className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#17171b] text-white disabled:opacity-50"><ArrowUp className="size-4" /></button></form>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </HutabyteShell>
  )
}
