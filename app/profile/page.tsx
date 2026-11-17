'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { LoaderCircle, Save, UserRound } from 'lucide-react'
import { HutabyteShell, PageHeading } from '@/components/hutabyte-shell'
import { authenticatedFetch } from '@/lib/supabase-browser'

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
  const [form, setForm] = useState({ full_name: '', profile_photo_url: '', position: '', department: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    void authenticatedFetch('/api/profile', { cache: 'no-store' })
      .then(async response => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || result.error || 'Profil tidak dapat dimuat.')
        if (!active) return
        const loaded = result as Profile
        setProfile(loaded)
        setForm({
          full_name: loaded.full_name || '',
          profile_photo_url: loaded.profile_photo_url || '',
          position: loaded.position || '',
          department: loaded.department || '',
        })
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : 'Profil tidak dapat dimuat.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

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
          profile_photo_url: form.profile_photo_url || null,
          position: form.position,
          department: form.department,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || result.error || 'Profil tidak dapat disimpan.')
      setProfile(result as Profile)
      setMessage('Profil berhasil diperbarui.')
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
          <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
            <section className="rounded-2xl border bg-card p-6">
              <div className="flex flex-col items-center text-center">
                {profile.profile_photo_url ? (
                  <img src={profile.profile_photo_url} alt="" className="size-24 rounded-full border object-cover" />
                ) : (
                  <div className="flex size-24 items-center justify-center rounded-full bg-muted text-2xl font-semibold text-muted-foreground">
                    {initials}
                  </div>
                )}
                <h2 className="mt-4 text-base font-semibold">{profile.full_name || 'Nama belum diatur'}</h2>
                <p className="mt-1 break-all text-xs text-muted-foreground">{profile.email}</p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]">
                    <span className={`size-2 rounded-full ${profile.online_status === 'online' ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                    {profile.online_status === 'online' ? 'Online' : 'Offline'}
                  </span>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] capitalize">{profile.account_status}</span>
                </div>
                <div className="mt-5 w-full border-t pt-4 text-left text-xs">
                  <p className="text-muted-foreground">Jabatan</p>
                  <p className="mt-1 font-medium">{profile.position || 'Belum diatur'}</p>
                  <p className="mt-4 text-muted-foreground">Departemen</p>
                  <p className="mt-1 font-medium">{profile.department || 'Belum diatur'}</p>
                </div>
              </div>
            </section>

            <form onSubmit={saveProfile} className="rounded-2xl border bg-card p-5 sm:p-6">
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
                  <input value={profile.email} readOnly className="cursor-not-allowed rounded-lg border bg-muted px-3 py-2.5 text-sm text-muted-foreground" />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium">
                  Jabatan
                  <input maxLength={120} value={form.position} onChange={event => setForm(current => ({ ...current, position: event.target.value }))} placeholder="Contoh: Product Manager" className="rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium">
                  Departemen
                  <input maxLength={120} value={form.department} onChange={event => setForm(current => ({ ...current, department: event.target.value }))} placeholder="Contoh: Product" className="rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium sm:col-span-2">
                  URL foto profil
                  <input type="url" maxLength={2048} value={form.profile_photo_url} onChange={event => setForm(current => ({ ...current, profile_photo_url: event.target.value }))} placeholder="https://..." className="rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
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
