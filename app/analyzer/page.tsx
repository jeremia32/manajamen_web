'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Cloud, FileText, FolderOpen, Globe, HardDriveUpload, LoaderCircle, UploadCloud } from 'lucide-react'
import { ActionIcon, HutabyteShell, PageHeading } from '@/components/hutabyte-shell'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { authenticatedFetch } from '@/lib/supabase-browser'

const supportedTypes = '.pdf,.docx,.txt,.md'
const maxFileSize = 50 * 1024 * 1024
type DriveFile = { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }

export default function AnalyzerPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [driveConnected, setDriveConnected] = useState(false)
  const [driveEmail, setDriveEmail] = useState('')
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([])
  const [drivePickerOpen, setDrivePickerOpen] = useState(false)
  const [driveLoading, setDriveLoading] = useState(false)
  const [driveConnecting, setDriveConnecting] = useState(false)
  const [driveImporting, setDriveImporting] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('googleDriveError')
    if (error) {
      toast.error(error)
      router.replace('/analyzer', { scroll: false })
    } else if (params.get('googleDrive') === 'connected') {
      router.replace('/analyzer', { scroll: false })
      void loadDriveFiles()
    }
  }, [router])

  async function loadDriveFiles() {
    setDriveLoading(true)
    try {
      const response = await authenticatedFetch('/api/google-drive/files')
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Daftar file Google Drive gagal dimuat.')
      setDriveFiles(result.files ?? [])
      setDriveEmail(result.email ?? '')
      setDriveConnected(true)
      setDrivePickerOpen(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Daftar file Google Drive gagal dimuat.')
    } finally {
      setDriveLoading(false)
    }
  }

  async function openGoogleDrive() {
    if (driveConnecting || uploading) return
    setDriveConnecting(true)
    try {
      const connectionResponse = await authenticatedFetch('/api/google-drive/connection')
      const connection = await connectionResponse.json()
      if (connectionResponse.ok && connection.connected) {
        setDriveConnected(true)
        setDriveEmail(connection.email ?? '')
        await loadDriveFiles()
        return
      }

      const response = await authenticatedFetch('/api/google-drive/auth/start', { method: 'POST' })
      const result = await response.json()
      if (!response.ok || !result.authorizationUrl) {
        throw new Error(result.detail || 'Tidak dapat memulai koneksi Google Drive.')
      }
      const authorizationUrl = new URL(result.authorizationUrl)
      if (authorizationUrl.origin !== 'https://accounts.google.com') {
        throw new Error('URL login Google tidak valid.')
      }
      window.location.assign(authorizationUrl.toString())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Tidak dapat menghubungkan Google Drive.')
    } finally {
      setDriveConnecting(false)
    }
  }

  async function importDriveFile(file: DriveFile) {
    if (driveImporting) return
    setDriveImporting(file.id)
    try {
      const response = await authenticatedFetch('/api/google-drive/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: file.id }),
      })
      const result = await response.json()
      if (!response.ok || !result.documentId) {
        throw new Error(result.detail || 'File Google Drive gagal diimpor.')
      }
      setDrivePickerOpen(false)
      toast.success('File Google Drive berhasil diimpor dan diindeks.')
      router.push(`/analyzer/${result.documentId}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'File Google Drive gagal diimpor.')
    } finally {
      setDriveImporting(null)
    }
  }

  async function disconnectGoogleDrive() {
    setDriveConnecting(true)
    try {
      const response = await authenticatedFetch('/api/google-drive/connection', { method: 'DELETE' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Google Drive gagal diputuskan.')
      setDriveConnected(false)
      setDriveEmail('')
      setDriveFiles([])
      setDrivePickerOpen(false)
      toast.success('Google Drive berhasil diputuskan.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Google Drive gagal diputuskan.')
    } finally {
      setDriveConnecting(false)
    }
  }

  async function uploadFile(file?: File) {
    if (!file || uploading) return
    if (!/\.(pdf|docx|txt|md)$/i.test(file.name)) {
      toast.error('Format yang didukung: PDF, DOCX, TXT, dan MD.')
      return
    }
    if (file.size > maxFileSize) {
      toast.error('Ukuran file maksimum 50 MB.')
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.set('file', file)
      const response = await authenticatedFetch('/api/documents', { method: 'POST', body: formData })
      const result = await response.json()
      if (!response.ok || !result.documentId) {
        throw new Error(result.detail || result.error || 'File gagal diunggah.')
      }
      toast.success('File berhasil diunggah. Analisis sedang disiapkan.')
      router.push(`/analyzer/${result.documentId}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Tidak dapat mengunggah file.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <HutabyteShell>
      <div className="mx-auto max-w-[1000px] px-5 py-10 sm:px-8 lg:px-12">
        <PageHeading title="Analisis dokumen dengan presisi AI" description="Unggah kontrak, perjanjian, dan kebijakan untuk mendapatkan wawasan, penilaian risiko, dan rekomendasi yang dapat ditindaklanjuti." />
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-4 text-center text-sm font-medium">Pilih metode impor</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="rounded-xl border border-[#dedee4] bg-white p-5 text-left transition hover:border-[#5963dc] hover:shadow-md disabled:opacity-60">
              <ActionIcon><UploadCloud className="size-4" /></ActionIcon>
              <h3 className="mt-4 text-sm font-semibold">Unggah File</h3>
              <p className="mt-1 text-xs text-[#8d8d96]">PDF, DOCX, TXT, atau MD hingga 50 MB</p>
            </button>
            {[["Website URL", Globe, "Import from any public webpage"]].map(([title, Icon, detail]) => (
              <div key={title as string} className="rounded-xl border border-[#e6e6ea] bg-white p-5 opacity-60">
                <ActionIcon tone="green"><Icon className="size-4" /></ActionIcon>
                <h3 className="mt-4 text-sm font-semibold">{title as string}</h3>
                <p className="mt-1 text-xs text-[#8d8d96]">{detail as string}</p>
                <span className="mt-3 inline-block text-[10px] font-medium text-[#a4a4ab]">Segera hadir</span>
              </div>
            ))}
            <button type="button" onClick={() => void openGoogleDrive()} disabled={driveConnecting || uploading} className="rounded-xl border border-[#dedee4] bg-white p-5 text-left transition hover:border-[#5963dc] hover:shadow-md disabled:opacity-60">
              <ActionIcon tone="green"><HardDriveUpload className="size-4" /></ActionIcon>
              <h3 className="mt-4 text-sm font-semibold">{driveConnecting ? 'Menghubungkan...' : driveConnected ? 'Pilih dari Google Drive' : 'Google Drive'}</h3>
              <p className="mt-1 text-xs text-[#8d8d96]">Hubungkan akun untuk memilih file pribadi yang didukung</p>
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {[["SharePoint", Cloud, "Access enterprise documents"], ["Dropbox", FolderOpen, "Import from Dropbox storage"]].map(([title, Icon, detail], index) => (
              <div key={title as string} className="flex items-center gap-3 rounded-xl border border-[#e6e6ea] bg-white p-4 opacity-60">
                <ActionIcon tone={index ? 'blue' : 'amber'}><Icon className="size-4" /></ActionIcon>
                <div><h3 className="text-xs font-semibold">{title as string}</h3><p className="mt-1 text-[10px] text-[#8d8d96]">{detail as string}</p></div>
              </div>
            ))}
          </div>
          <input ref={inputRef} type="file" accept={supportedTypes} className="sr-only" onChange={event => { void uploadFile(event.target.files?.[0]); event.currentTarget.value = '' }} />
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inputRef.current?.click() } }}
            onDragOver={event => { event.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={event => { event.preventDefault(); setDragging(false); void uploadFile(event.dataTransfer.files[0]) }}
            className={`mt-9 flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition ${dragging ? 'border-[#5963dc] bg-[#f0f0ff]' : 'border-[#cfcfd8] bg-white hover:border-[#5963dc]'}`}
          >
            <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-[#f0f0ff] text-[#5963dc]">
              {uploading ? <LoaderCircle className="size-6 animate-spin" /> : <UploadCloud className="size-6" />}
            </div>
            <h3 className="mt-4 text-sm font-semibold">{uploading ? 'Mengunggah dan mengindeks dokumen...' : 'Tarik dokumen ke sini'}</h3>
            <p className="mt-1 text-xs text-[#92929a]">atau pilih dari komputer · PDF, DOCX, TXT, MD · maksimal 50 MB</p>
            <span className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#17171b] px-4 py-2.5 text-xs font-semibold text-white">
              <UploadCloud className="size-3.5" /> Pilih File
            </span>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-[10px] text-[#9a9aa2]">
            <span className="flex items-center gap-1.5"><Check className="size-3 text-[#43a878]" />Secure processing</span>
            <span>Format: PDF, DOCX, TXT, MD</span>
            <span>Maksimal 50 MB</span>
          </div>
        </div>
      </div>
      <Dialog open={drivePickerOpen} onOpenChange={setDrivePickerOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pilih file Google Drive</DialogTitle>
            <DialogDescription>{driveEmail ? `Terhubung sebagai ${driveEmail}.` : 'Pilih dokumen untuk diimpor dan dianalisis.'} Format: Google Docs, PDF, DOCX, TXT, dan MD · maksimal 50 MB.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto rounded-lg border">
            {driveLoading ? (
              <p className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Memuat file Drive...</p>
            ) : driveFiles.length ? (
              driveFiles.map(file => (
                <div key={file.id} className="flex items-center justify-between gap-3 border-b p-3 last:border-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText className="size-4 shrink-0 text-[#5963dc]" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{file.name}</p>
                      <p className="text-[11px] text-muted-foreground">{file.mimeType === 'application/vnd.google-apps.document' ? 'Google Docs · akan diimpor sebagai PDF' : file.mimeType.split('/').pop()?.toUpperCase()}{file.size ? ` · ${(Number(file.size) / (1024 * 1024)).toFixed(1)} MB` : ''}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => void importDriveFile(file)} disabled={driveImporting !== null} className="shrink-0 rounded-md bg-[#17171b] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                    {driveImporting === file.id ? <LoaderCircle className="size-4 animate-spin" /> : 'Impor'}
                  </button>
                </div>
              ))
            ) : (
              <p className="p-8 text-center text-sm text-muted-foreground">Tidak ada file yang didukung di Google Drive.</p>
            )}
          </div>
          <div className="flex justify-between gap-3 border-t pt-4">
            <button type="button" onClick={() => void disconnectGoogleDrive()} disabled={driveConnecting} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">Putuskan akun Google</button>
            <button type="button" onClick={() => void loadDriveFiles()} disabled={driveLoading} className="rounded-md border px-3 py-2 text-xs font-medium disabled:opacity-50">Muat ulang</button>
          </div>
        </DialogContent>
      </Dialog>
    </HutabyteShell>
  )
}
