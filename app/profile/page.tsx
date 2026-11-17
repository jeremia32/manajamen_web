'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BriefcaseBusiness, Building2, Camera, LoaderCircle, Mail, Save, UserRound } from 'lucide-react'
import { HutabyteShell, PageHeading } from '@/components/hutabyte-shell'
import { authenticatedFetch, readApiResponse } from '@/lib/supabase-browser'

type Profile = {
  user_id: string
  email: string
  full_name: string
  profile_photo_url: string | null
  position: string
  department: string
  account_status: string
  online_status: 'online' | 'offline'
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [form, setForm] = useState({ full_name: '', position: '', department: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const photoInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    void authenticatedFetch('/api/profile', { cache: 'no-store' })
      .then(response => readApiResponse<Profile>(response, 'Profil tidak dapat dimuat.'))
      .then(result => {
        if (!active) return
        setProfile(result)
        setForm({
          full_name: result.full_name || '',
          position: result.position || '',
          department: result.department || '',
        })
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : 'Profil tidak dapat dimuat.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function uploadPhoto(file?: File) {
    if (!file || uploadingPhoto) return
    setError('')
    setMessage('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Pilih foto berformat JPG, PNG, atau WebP.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Ukuran foto profil maksimum adalah 5 MB.')
      return
    }

    setUploadingPhoto(true)
    setError('')
    setMessage('')
    try {
      const body = new FormData()
      body.set('file', file)
      const response = await authenticatedFetch('/api/profile/photo', { method: 'POST', body })
      const result = await readApiResponse<Profile>(response, 'Foto profil gagal diunggah.')
      setProfile(result)
      setMessage('Foto profil berhasil diunggah ke Supabase.')
      window.dispatchEvent(new Event('profile-updated'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Foto profil gagal diunggah.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await authenticatedFetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: form.full_name,
          position: form.position,
          department: form.department,
        }),
      })
      const result = await readApiResponse<Profile>(response, 'Profil tidak dapat disimpan.')
      setProfile(result)
      setMessage('Profil berhasil diperbarui.')
      window.dispatchEvent(new Event('profile-updated'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Profil tidak dapat disimpan.')
    } finally {
      setSaving(false)
    }
  }

  const initials = (profile?.full_name || profile?.email || '?').slice(0, 1).toUpperCase()

  return (
    <HutabyteShell>
      <div className="mx-auto max-w-[900px] px-5 py-10 sm:px-8 lg:px-12">
        <PageHeading eyebrow="Akun workspace" title="Profil Anda" description="Kelola informasi yang dilihat rekan kerja saat memilih peserta meeting." />
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border bg-card p-6 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Memuat profil...
          </div>
        ) : profile ? (
          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            <section className="relative overflow-hidden rounded-2xl border bg-card p-6 shadow-sm lg:sticky lg:top-24 lg:self-start">
              <div aria-hidden="true" className="absolute inset-x-0 top-0 h-28 bg-gradient-to-br from-primary/20 via-primary/5 to-transparent" />
              <div className="relative flex flex-col items-center text-center">
                <div className="group relative">
                  {profile.profile_photo_url ? (
                    <img src={profile.profile_photo_url} alt="Foto profil" className="size-28 rounded-full border-4 border-background object-cover shadow-md" />
                  ) : (
                    <div className="flex size-28 items-center justify-center rounded-full border-4 border-background bg-primary/10 text-3xl font-semibold text-primary shadow-md">
                      {initials}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => photoInput.current?.click()}
                    disabled={uploadingPhoto}
                    aria-label="Pilih foto profil dari komputer"
                    title="Pilih foto profil"
                    className="absolute bottom-1 right-1 flex size-9 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-sm transition hover:scale-105 disabled:opacity-60"
                  >
                    {uploadingPhoto ? <LoaderCircle className="size-4 animate-spin" /> : <Camera className="size-4" />}
                  </button>
                </div>
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={event => { void uploadPhoto(event.target.files?.[0]); event.currentTarget.value = '' }}
                />
                <h2 className="mt-4 text-base font-semibold">{profile.full_name || 'Nama belum diatur'}</h2>
                <p className="mt-1 break-all text-xs text-muted-foreground">{profile.email}</p>
                <button
                  type="button"
                  onClick={() => photoInput.current?.click()}
                  disabled={uploadingPhoto}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs font-semibold shadow-sm transition hover:bg-muted disabled:opacity-60"
                >
                  {uploadingPhoto ? <LoaderCircle className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
                  {uploadingPhoto ? 'Mengunggah foto...' : profile.profile_photo_url ? 'Ganti foto' : 'Unggah foto'}
                </button>
                <p className="mt-2 text-[10px] text-muted-foreground">JPG, PNG, atau WebP · maksimal 5 MB</p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]">
                    <span className={`size-2 rounded-full ${profile.online_status === 'online' ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                    {profile.online_status === 'online' ? 'Online' : 'Offline'}
                  </span>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] capitalize">{profile.account_status}</span>
                </div>
                <div className="mt-5 w-full border-t pt-4 text-left text-xs">
                  <div className="flex items-start gap-3">
                    <BriefcaseBusiness className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 text-left"><p className="text-muted-foreground">Jabatan</p><p className="mt-1 truncate font-medium">{profile.position || 'Belum diatur'}</p></div>
                  </div>
                  <div className="mt-4 flex items-start gap-3">
                    <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 text-left"><p className="text-muted-foreground">Departemen</p><p className="mt-1 truncate font-medium">{profile.department || 'Belum diatur'}</p></div>
                  </div>
                </div>
              </div>
            </section>

            <form onSubmit={saveProfile} className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
              <div className="mb-5 flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><UserRound className="size-5" /></span>
                <div><h2 className="text-sm font-semibold">Informasi profil</h2><p className="mt-1 text-xs text-muted-foreground">Email dan status akun dikelola oleh autentikasi workspace.</p></div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-xs font-medium">
                  Nama lengkap
                  <input required maxLength={120} value={form.full_name} onChange={event => setForm(current => ({ ...current, full_name: event.target.value }))} className="rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium">
                  Email
                  <span className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input value={profile.email} readOnly className="w-full cursor-not-allowed rounded-lg border bg-muted py-2.5 pl-9 pr-3 text-sm text-muted-foreground" />
                  </span>
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium">
                  Jabatan
                  <input maxLength={120} value={form.position} onChange={event => setForm(current => ({ ...current, position: event.target.value }))} placeholder="Contoh: Product Manager" className="rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium">
                  Departemen
                  <input maxLength={120} value={form.department} onChange={event => setForm(current => ({ ...current, department: event.target.value }))} placeholder="Contoh: Product" className="rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
              </div>
              {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}
              {message && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{message}</p>}
              <div className="mt-6 flex justify-end">
                <button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
                  {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Simpan profil
                </button>
              </div>
            </form>
          </div>
        ) : (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error || 'Profil tidak dapat dimuat.'}</p>
        )}
      </div>
    </HutabyteShell>
  )
}
