'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, Archive, BookOpen, Check, ChevronDown, CircleHelp, Cloud, Database, FileCode2, FileText, FolderGit2, Globe2, KeyRound, Link2, Loader2, MoreHorizontal, Plus, RefreshCw, Search, Server, Settings2, ShieldCheck, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { HutabyteShell, PageHeading } from '@/components/hutabyte-shell'
import { authenticatedFetch } from '@/lib/supabase-browser'
import { MOCK_DOCUMENTS, MOCK_SYNC_RUNS, SOURCE_LABELS, SOURCE_ICONS, STATUS_LABELS, type IndexedDocument, type KnowledgeSource, type SourceCreateInput, type SourceType, type SyncRun } from '@/lib/types'

const connectorCatalog: { type: SourceType; title: string; description: string; icon: typeof BookOpen; disabled?: boolean }[] = [
  { type: 'outline', title: 'Outline (wiki)', description: 'Hubungkan wiki internal dan koleksi pengetahuan.', icon: BookOpen },
  { type: 'notion', title: 'Notion', description: 'Indeks halaman dan database Notion.', icon: FileText },
  { type: 'confluence', title: 'Confluence', description: 'Ambil dokumentasi dari ruang Confluence.', icon: Archive },
  { type: 'github', title: 'GitHub', description: 'Baca README dan dokumentasi repositori.', icon: FolderGit2 },
  { type: 'website', title: 'Situs Web / URL', description: 'Crawl halaman publik atau terlindungi.', icon: Globe2 },
  { type: 'rest', title: 'REST API Kustom', description: 'Gunakan endpoint API milik Anda.', icon: Server },
  { type: 'pdf', title: 'Unggah File (PDF)', description: 'Tambahkan dokumen PDF secara langsung.', icon: Upload },
  { type: 'google-drive', title: 'Google Drive', description: 'Integrasi penyimpanan cloud.', icon: Cloud, disabled: true },
  { type: 'sharepoint', title: 'SharePoint', description: 'Integrasi enterprise.', icon: Database, disabled: true },
  { type: 'dropbox', title: 'Dropbox', description: 'Integrasi penyimpanan cloud.', icon: Cloud, disabled: true },
]

const schema = z.object({ name: z.string().min(2, 'Nama sumber minimal 2 karakter.'), baseUrl: z.string().url('Masukkan URL yang valid.').optional().or(z.literal('')), apiKey: z.string().min(4, 'API key wajib diisi.').optional().or(z.literal('')), token: z.string().min(4, 'Token wajib diisi.').optional().or(z.literal('')), repository: z.string().optional(), endpoint: z.string().url('Masukkan endpoint URL yang valid.').optional().or(z.literal('')), url: z.string().url('Masukkan URL yang valid.').optional().or(z.literal('')), syncFrequency: z.enum(['manual', 'hourly', 'daily', 'weekly']), syncOnSave: z.boolean() })
type FormValues = z.infer<typeof schema>

function SourceIcon({ type, className = '' }: { type: SourceType; className?: string }) { return <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef0ff] text-[11px] font-bold text-[#5963dc] ${className}`}>{SOURCE_ICONS[type]}</span> }
function StatusBadge({ status }: { status: KnowledgeSource['status'] }) { const tone = status === 'connected' ? 'bg-[#e9f7ef] text-[#2d8b59]' : status === 'error' ? 'bg-[#fff0f0] text-[#c95f5f]' : status === 'syncing' ? 'bg-[#fff7e8] text-[#af771e]' : 'bg-[#f1f1f3] text-[#777780]'; return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${tone}`}>{STATUS_LABELS[status]}</span> }

function SourceDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (value: boolean) => void; onCreated: (source: KnowledgeSource) => void }) {
  const [step, setStep] = useState(1); const [selected, setSelected] = useState<SourceType | null>(null); const [testing, setTesting] = useState(false); const [testResult, setTestResult] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null); const [draggingFile, setDraggingFile] = useState(false); const fileInput = useRef<HTMLInputElement>(null)
    const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { syncFrequency: 'daily', syncOnSave: true } })
  const values = form.watch()
  useEffect(() => { if (!open) { setStep(1); setSelected(null); setTestResult(''); form.reset({ syncFrequency: 'daily', syncOnSave: true }) } }, [open, form])
  const choose = (type: SourceType) => { if (connectorCatalog.find(item => item.type === type)?.disabled) return; setSelected(type); form.setValue('name', connectorCatalog.find(item => item.type === type)?.title || '') }
  async function testConnection() {
    const valid = await form.trigger()
    if (!valid || !selected) return
    setTesting(true)
    setTestResult('')
    try {
      const input: SourceCreateInput = { name: values.name, type: selected, credentials: { apiKey: values.apiKey || values.token || '', baseUrl: values.baseUrl || values.url || values.endpoint || '', repository: values.repository || '' }, syncFrequency: values.syncFrequency, syncOnSave: values.syncOnSave }
      const response = await authenticatedFetch('/api/knowledge/sources', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.message || result.detail || 'Koneksi sumber gagal.')
      setTestResult(`${result.message}${typeof result.documentCount === 'number' ? ` Ditemukan ${result.documentCount} dokumen.` : ''}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Koneksi sumber gagal.')
    } finally {
      setTesting(false)
    }
  }
  async function save() {
    const valid = await form.trigger()
    if (!valid || !selected) return
    const input: SourceCreateInput = { name: values.name, type: selected, credentials: { apiKey: values.apiKey || values.token || '', baseUrl: values.baseUrl || values.url || values.endpoint || '', repository: values.repository || '' }, syncFrequency: values.syncFrequency, syncOnSave: values.syncOnSave }
    try {
      const response = await authenticatedFetch('/api/knowledge/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
      const source = await response.json()
      if (!response.ok) throw new Error(source.detail || source.error || 'Sumber gagal disimpan.')
      onCreated(source)
      toast.success('Sumber berhasil ditambahkan.')
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sumber gagal disimpan.')
    }
  }
  async function uploadFile() {
    if (!selectedFile || selected !== 'pdf') return
    const validName = await form.trigger('name')
    if (!validName) return
    setTesting(true)
    try {
      const upload = new FormData()
      upload.set('file', selectedFile)
      const uploadResponse = await authenticatedFetch('/api/documents', { method: 'POST', body: upload })
      const uploaded = await uploadResponse.json()
      if (!uploadResponse.ok) throw new Error(uploaded.error || uploaded.detail || 'File gagal diunggah.')

      const input: SourceCreateInput = { name: values.name, type: 'pdf', credentials: {}, syncFrequency: 'manual', syncOnSave: false }
      const sourceResponse = await authenticatedFetch('/api/knowledge/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
      if (!sourceResponse.ok) throw new Error('File berhasil diunggah, tetapi sumber belum dapat didaftarkan.')
      onCreated({ ...await sourceResponse.json(), documentCount: 1, status: 'connected' })
      toast.success('File berhasil diunggah dan diindeks.')
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'File gagal diunggah.')
    } finally {
      setTesting(false)
    }
  }
  const field = (label: string, name: keyof FormValues, placeholder: string, type = 'text') => {
    if (selected === 'outline' && (name === 'baseUrl' || name === 'apiKey')) return null
    return <div className="flex flex-col gap-2"><Label htmlFor={name}>{label}</Label><Input id={name} type={type} placeholder={placeholder} {...form.register(name)} />{selected === 'outline' && name === 'name' && <p className="text-[11px] leading-5 text-muted-foreground">Koneksi memakai OUTLINE_BASE_URL, OUTLINE_API_KEY, dan OUTLINE_COLLECTION_ID dari konfigurasi backend.</p>}{form.formState.errors[name] && <p className="text-[11px] text-destructive">{form.formState.errors[name]?.message as string}</p>}</div>
  }
  if (step === 2 && selected === 'pdf') {
    return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Unggah dokumen</DialogTitle><DialogDescription>Pilih file dari komputer atau seret file ke area unggah untuk menambahkannya ke basis pengetahuan.</DialogDescription></DialogHeader><div className="flex flex-col gap-4">{field('Nama Sumber', 'name', 'Contoh: Kebijakan Perusahaan')}<label htmlFor="knowledge-file-input" onDragOver={event => { event.preventDefault(); setDraggingFile(true) }} onDragLeave={() => setDraggingFile(false)} onDrop={event => { event.preventDefault(); setDraggingFile(false); setSelectedFile(event.dataTransfer.files[0] ?? null) }} className={`flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-5 py-8 text-center transition ${draggingFile ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60 hover:bg-muted/40'}`}><span className="flex size-11 items-center justify-center rounded-lg bg-muted"><Upload className="size-5 text-primary" /></span>{selectedFile ? <><span className="max-w-full truncate text-sm font-semibold">{selectedFile.name}</span><span className="text-xs text-muted-foreground">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB · pilih untuk mengganti file</span></> : <><span className="text-sm font-semibold">Pilih file dari komputer atau tarik ke sini</span><span className="text-xs text-muted-foreground">PDF, DOCX, TXT, atau MD · maksimal 50 MB</span><span className="rounded-md border px-3 py-1.5 text-xs font-medium">Pilih File</span></>}</label><input id="knowledge-file-input" type="file" accept=".pdf,.docx,.txt,.md" className="sr-only" onChange={event => setSelectedFile(event.target.files?.[0] ?? null)} /></div><div className="flex justify-between border-t pt-4"><Button type="button" variant="ghost" onClick={() => setStep(1)}>Kembali</Button><Button type="button" onClick={uploadFile} disabled={!selectedFile || testing}>{testing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}Unggah & Indeks</Button></div></DialogContent></Dialog>
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Tambah sumber pengetahuan</DialogTitle><DialogDescription>Hubungkan sumber perusahaan agar Asisten AI dapat membaca dan mencari informasinya.</DialogDescription></DialogHeader><div className="flex items-center gap-2 border-y py-4 text-xs"><span className={`flex size-6 items-center justify-center rounded-full ${step >= 1 ? 'bg-[#5963dc] text-white' : 'bg-muted'}`}>1</span><span className={step >= 1 ? 'font-semibold' : 'text-muted-foreground'}>Pilih jenis sumber</span><div className="h-px flex-1 bg-border" /><span className={`flex size-6 items-center justify-center rounded-full ${step >= 2 ? 'bg-[#5963dc] text-white' : 'bg-muted'}`}>2</span><span className={step >= 2 ? 'font-semibold' : 'text-muted-foreground'}>Isi kredensial</span><div className="h-px flex-1 bg-border" /><span className={`flex size-6 items-center justify-center rounded-full ${step >= 3 ? 'bg-[#5963dc] text-white' : 'bg-muted'}`}>3</span><span className={step >= 3 ? 'font-semibold' : 'text-muted-foreground'}>Uji & sinkronisasi</span></div>{step === 1 && <div className="grid gap-3 sm:grid-cols-2"><p className="col-span-full text-xs text-muted-foreground">Pilih konektor yang ingin digunakan.</p>{connectorCatalog.map(item => <button key={item.type} type="button" disabled={item.disabled} onClick={() => choose(item.type)} className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${selected === item.type ? 'border-[#5963dc] bg-[#f5f5ff]' : 'border-border hover:border-[#b8baf0]'} ${item.disabled ? 'cursor-not-allowed opacity-50' : ''}`}><span className="flex size-9 items-center justify-center rounded-lg bg-muted"><item.icon className="size-4" /></span><span className="min-w-0"><span className="flex items-center gap-2 text-sm font-semibold">{item.title}{item.disabled && <Badge variant="secondary">Segera Hadir</Badge>}</span><span className="mt-1 block text-xs text-muted-foreground">{item.description}</span></span></button>)}</div>}{step === 2 && selected && <div className="flex flex-col gap-4"><div className="rounded-lg border border-[#dfe2ff] bg-[#f5f5ff] p-3 text-xs text-[#555b9e]"><ShieldCheck className="mr-2 inline size-4" />API key disimpan terenkripsi di server dan tidak akan ditampilkan kembali.</div>{field('Nama Sumber', 'name', 'Contoh: Wiki Perusahaan')}{(selected === 'outline' || selected === 'confluence') && field('Base URL', 'baseUrl', selected === 'outline' ? 'https://app.getoutline.com' : 'https://perusahaan.atlassian.net')}{selected === 'notion' && field('Integration Token', 'token', 'secret_...', 'password')}{selected === 'github' && <>{field('Personal Access Token', 'token', 'ghp_...', 'password')}{field('Repository', 'repository', 'owner/repo')}</>}{selected === 'website' && field('URL', 'url', 'https://contoh.com')}{selected === 'rest' && <>{field('Endpoint URL', 'endpoint', 'https://api.contoh.com/documents')}{field('Header Auth', 'apiKey', 'Authorization: Bearer ...', 'password')}</>}{(selected === 'outline' || selected === 'confluence') && field(selected === 'outline' ? 'API Key' : 'API Token', 'apiKey', 'Masukkan key rahasia', 'password')}<p className="text-xs text-muted-foreground">Edit lanjutan seperti filter koleksi, Space Key, Branch, dan JSON path tersedia setelah koneksi diuji.</p></div>}{step === 3 && <div className="flex flex-col gap-5"><div className="rounded-xl border bg-muted/30 p-5"><div className="flex items-center gap-3"><SourceIcon type={selected || 'outline'} /><div><p className="text-sm font-semibold">{values.name}</p><p className="text-xs text-muted-foreground">{selected ? SOURCE_LABELS[selected] : ''}</p></div></div><div className="mt-5 flex flex-col gap-2"><Label>Frekuensi sinkronisasi</Label><Select value={values.syncFrequency} onValueChange={value => form.setValue('syncFrequency', value as FormValues['syncFrequency'])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">Manual</SelectItem><SelectItem value="hourly">Setiap jam</SelectItem><SelectItem value="daily">Harian</SelectItem><SelectItem value="weekly">Mingguan</SelectItem></SelectContent></Select></div><label className="mt-4 flex items-center gap-2 text-xs"><Checkbox checked={values.syncOnSave} onCheckedChange={value => form.setValue('syncOnSave', value === true)} />Sinkronkan otomatis saat pertama kali disimpan</label></div>{testResult && <div className="flex items-center gap-2 rounded-lg border border-[#bde6cd] bg-[#f0fbf4] p-3 text-xs text-[#2d8b59]"><Check className="size-4" />{testResult}</div>}<p className="text-xs text-muted-foreground">Kredensial hanya dikirim ke server saat koneksi diuji atau disimpan.</p></div>}<div className="flex justify-between border-t pt-4"><Button type="button" variant="ghost" onClick={() => step === 1 ? onOpenChange(false) : setStep(step - 1)}>{step === 1 ? 'Batal' : 'Kembali'}</Button>{step < 3 ? <Button type="button" disabled={step === 1 && !selected} onClick={() => step === 1 ? setStep(2) : setStep(3)}>{step === 1 ? 'Lanjutkan' : 'Lanjut ke uji koneksi'}</Button> : <div className="flex gap-2"><Button type="button" variant="outline" onClick={testConnection} disabled={testing}>{testing ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}Uji Koneksi</Button><Button type="button" onClick={save}>Simpan Sumber</Button></div>}</div></DialogContent></Dialog>
}

function ConnectedSources({ sources, onAdd, onRefresh }: { sources: KnowledgeSource[]; onAdd: () => void; onRefresh: () => void }) {
  const [menu, setMenu] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  async function sync(id: string) {
    setSyncing(id)
    try {
      const response = await authenticatedFetch(`/api/knowledge/sources/${id}/sync`, { method: 'POST' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || result.error || 'Sinkronisasi gagal.')
      toast.success(`Sinkronisasi selesai: ${result.added ?? 0} baru, ${result.updated ?? 0} diperbarui, ${result.failed ?? 0} gagal.`)
      await onRefresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sinkronisasi gagal.')
      await onRefresh()
    } finally {
      setSyncing(null)
    }
  }
  async function remove(id: string) {
    try {
      const response = await authenticatedFetch(`/api/knowledge/sources/${id}`, { method: 'DELETE' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || result.error || 'Sumber gagal dihapus.')
      toast.success('Sumber dihapus.')
      await onRefresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sumber gagal dihapus.')
    }
  }
  return <div className="flex flex-col gap-4"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Sumber terhubung</h2><p className="text-xs text-muted-foreground">Kelola koneksi yang digunakan oleh Asisten AI.</p></div><Button onClick={onAdd}><Plus data-icon="inline-start" />Tambah Sumber</Button></div>{sources.length === 0 ? <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-12 text-center"><div className="flex size-12 items-center justify-center rounded-full bg-[#f0f0ff]"><Database className="size-5 text-[#5963dc]" /></div><h3 className="text-sm font-semibold">Belum ada sumber terhubung</h3><p className="max-w-sm text-xs text-muted-foreground">Hubungkan wiki, Notion, GitHub, atau unggah PDF untuk mulai membangun basis pengetahuan.</p><Button variant="outline" onClick={onAdd}>Tambah Sumber Pertama</Button></div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{sources.map(source => <div key={source.id} className="relative rounded-2xl border bg-card p-5"><div className="flex items-start justify-between"><div className="flex items-center gap-3"><SourceIcon type={source.type} /><div><h3 className="text-sm font-semibold">{source.name}</h3><p className="text-[11px] text-muted-foreground">{SOURCE_LABELS[source.type]}</p></div></div><div className="relative"><Button variant="ghost" size="icon" onClick={() => setMenu(menu === source.id ? null : source.id)} aria-label="Menu sumber"><MoreHorizontal /></Button>{menu === source.id && <div className="absolute right-0 top-9 z-10 w-44 rounded-lg border bg-popover p-1 text-xs shadow-lg"><button disabled={syncing === source.id} className="flex w-full rounded px-2 py-2 text-left hover:bg-muted disabled:opacity-50" onClick={() => sync(source.id)}>{syncing === source.id ? 'Menyinkronkan...' : 'Sinkronkan Sekarang'}</button><button className="flex w-full rounded px-2 py-2 text-left hover:bg-muted">Edit Koneksi</button><button className="flex w-full rounded px-2 py-2 text-left hover:bg-muted" onClick={() => sync(source.id)}>Uji Koneksi & Sinkronkan</button><button className="flex w-full rounded px-2 py-2 text-left text-destructive hover:bg-muted" onClick={() => remove(source.id)}>Hapus</button></div>}</div></div><div className="mt-5 flex items-center gap-2"><StatusBadge status={source.status} /><span className="text-[11px] text-muted-foreground">{source.documentCount} dokumen</span></div><div className="mt-4 flex items-center justify-between border-t pt-3 text-[11px] text-muted-foreground"><span>Sinkronisasi terakhir</span><span>{source.lastSync || 'Belum pernah'}</span></div></div>)}</div>}</div>
}

function DocumentsTab({ sources }: { sources: KnowledgeSource[] }) { const [query, setQuery] = useState(''); const [documents, setDocuments] = useState<IndexedDocument[]>(MOCK_DOCUMENTS); useEffect(() => { authenticatedFetch('/api/documents').then(response => response.json()).then(data => { if (Array.isArray(data.documents)) setDocuments(data.documents.map((doc: { id: string; name: string; type: string; size: string; status: string; createdAt: string; sourceId?: string; sourceName?: string }) => ({ id: doc.id, name: doc.name, type: doc.type, size: doc.size, updatedAt: doc.createdAt, sourceId: doc.sourceId ?? 'uploaded', sourceName: doc.sourceName ?? 'Unggah file', status: doc.status.toLowerCase() === 'indexed' ? 'indexed' : doc.status.toLowerCase() === 'failed' ? 'failed' : 'processing' }))) }).catch(() => {}) }, []); const docs = useMemo(() => documents.filter(doc => doc.name.toLowerCase().includes(query.toLowerCase())), [documents, query]); return <div className="flex flex-col gap-4"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div><h2 className="text-sm font-semibold">Semua dokumen</h2><p className="text-xs text-muted-foreground">Dokumen terindeks dari semua sumber.</p></div><div className="flex items-center gap-2"><div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs"><Search className="size-3.5 text-muted-foreground" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari dokumen..." className="w-40 bg-transparent outline-none" /></div><Button variant="outline" size="sm"><SlidersHorizontal data-icon="inline-start" />Filter</Button></div></div><div className="overflow-hidden rounded-xl border"><div className="hidden grid-cols-[1.7fr_1.2fr_.7fr_.8fr_.8fr_40px] gap-4 bg-muted/40 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:grid"><span>Dokumen</span><span>Sumber</span><span>Jenis</span><span>Ukuran</span><span>Status</span><span /></div>{docs.map(doc => <div key={doc.id} className="grid gap-2 border-t px-4 py-4 sm:grid-cols-[1.7fr_1.2fr_.7fr_.8fr_.8fr_40px] sm:items-center sm:gap-4"><div className="flex items-center gap-2"><FileText className="size-4 text-[#5963dc]" /><span className="text-xs font-medium">{doc.name}</span></div><span className="text-xs text-muted-foreground">{doc.sourceName}</span><span className="text-xs text-muted-foreground">{doc.type}</span><span className="text-xs text-muted-foreground">{doc.size}</span><Badge variant={doc.status === 'indexed' ? 'secondary' : doc.status === 'failed' ? 'destructive' : 'outline'}>{doc.status === 'indexed' ? 'Terindeks' : doc.status === 'failed' ? 'Gagal' : 'Diproses'}</Badge><Button variant="ghost" size="icon" aria-label="Hapus dokumen"><Trash2 /></Button></div>)}</div></div> }
function SyncHistory({ runs }: { runs: SyncRun[] }) { return <div className="flex flex-col gap-4"><div><h2 className="text-sm font-semibold">Riwayat sinkronisasi</h2><p className="text-xs text-muted-foreground">Pantau aktivitas sinkronisasi setiap sumber.</p></div><div className="overflow-hidden rounded-xl border"><div className="hidden grid-cols-[1.4fr_1fr_.7fr_.7fr_.7fr_.8fr] gap-4 bg-muted/40 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:grid"><span>Sumber</span><span>Mulai</span><span>Durasi</span><span>Ditambah</span><span>Diperbarui</span><span>Status</span></div>{runs.map(run => <details key={run.id} className="group border-t"><summary className="grid cursor-pointer list-none gap-2 px-4 py-4 sm:grid-cols-[1.4fr_1fr_.7fr_.7fr_.7fr_.8fr] sm:items-center"><span className="flex items-center gap-2 text-xs font-medium"><ChevronDown className="size-3 transition group-open:rotate-180" />{run.sourceName}</span><span className="text-xs text-muted-foreground">{run.startedAt}</span><span className="text-xs text-muted-foreground">{run.duration}</span><span className="text-xs text-muted-foreground">{run.added}</span><span className="text-xs text-muted-foreground">{run.updated}</span><Badge variant={run.status === 'success' ? 'secondary' : 'destructive'}>{run.status === 'success' ? 'Berhasil' : 'Gagal'}</Badge></summary>{run.error && <div className="mx-4 mb-4 rounded-lg bg-[#fff5f5] p-3 text-xs text-[#b04e4e]"><AlertCircle className="mr-2 inline size-4" />{run.error}</div>}</details>)}</div></div> }

export default function KnowledgePage() {
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('sources')
  const [runs] = useState(MOCK_SYNC_RUNS)

  async function refresh() {
    try {
      const response = await authenticatedFetch('/api/knowledge/sources')
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || result.error || 'Sumber gagal dimuat.')
      setSources(result)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sumber gagal dimuat.')
    }
  }

  function saveSource(source: KnowledgeSource) {
    setSources(current => [...current.filter(existing => existing.id !== source.id), source])
  }

  useEffect(() => { void refresh() }, [])
  const totalDocs = sources.reduce((sum, source) => sum + source.documentCount, 0)
  const latestSync = sources.map(source => source.lastSync).filter((value): value is string => Boolean(value)).sort().at(-1)

  return <HutabyteShell><Toaster /><div className="mx-auto max-w-[1240px] px-5 py-8 sm:px-8 lg:px-12"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><PageHeading title="Basis Pengetahuan" description="Hubungkan sumber pengetahuan perusahaan agar Asisten AI dapat membaca dan mencari informasi di dalamnya." /><Button onClick={() => setOpen(true)}><Plus data-icon="inline-start" />Tambah Sumber</Button></div><div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Summary label="Total Sumber Terhubung" value={sources.length} icon={Link2} /><Summary label="Total Dokumen Terindeks" value={totalDocs} icon={FileText} /><Summary label="Sinkronisasi Terakhir" value={latestSync ? new Date(latestSync).toLocaleString('id-ID') : 'Belum pernah'} icon={RefreshCw} /><Summary label="Sumber Bermasalah" value={sources.filter(source => source.status === 'error').length} icon={AlertCircle} /></div><Tabs value={tab} onValueChange={setTab} className="mt-8"><TabsList><TabsTrigger value="sources">Sumber Terhubung</TabsTrigger><TabsTrigger value="documents">Semua Dokumen</TabsTrigger><TabsTrigger value="history">Riwayat Sinkronisasi</TabsTrigger></TabsList><TabsContent value="sources" className="mt-6"><ConnectedSources sources={sources} onAdd={() => setOpen(true)} onRefresh={refresh} /></TabsContent><TabsContent value="documents" className="mt-6"><DocumentsTab sources={sources} /></TabsContent><TabsContent value="history" className="mt-6"><SyncHistory runs={runs} /></TabsContent></Tabs></div><SourceDialog open={open} onOpenChange={setOpen} onCreated={saveSource} /></HutabyteShell>
}
function Summary({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Link2 }) { return <div className="rounded-2xl border bg-card p-4"><div className="flex items-center justify-between"><p className="text-[11px] text-muted-foreground">{label}</p><Icon className="size-4 text-[#5963dc]" /></div><p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p></div> }

