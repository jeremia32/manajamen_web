'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { LoaderCircle, Search, UsersRound, X } from 'lucide-react'
import {
  fromJakartaInput,
  meetingRequest,
  toJakartaInput,
  type Meeting,
  type MeetingInput,
  type MeetingParticipant,
  type WorkspaceProfile,
} from '@/lib/meetings-client'

type Props = {
  initialMeeting?: Meeting
  initialParticipants?: MeetingParticipant[]
  currentUserId: string
  submitLabel: string
  onSubmit: (payload: MeetingInput) => Promise<void>
  onCancel: () => void
}

function defaultStartInput() {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0)
  return toJakartaInput(date.toISOString())
}

function avatarInitial(profile: WorkspaceProfile) {
  return (profile.full_name || profile.email || '?').slice(0, 1).toUpperCase()
}

export function MeetingForm({
  initialMeeting,
  initialParticipants = [],
  currentUserId,
  submitLabel,
  onSubmit,
  onCancel,
}: Props) {
  const [title, setTitle] = useState(initialMeeting?.title || '')
  const [description, setDescription] = useState(initialMeeting?.description || '')
  const [location, setLocation] = useState(initialMeeting?.location || '')
  const [meetingType, setMeetingType] = useState(initialMeeting?.meeting_type || 'team')
  const [startValue, setStartValue] = useState(initialMeeting ? toJakartaInput(initialMeeting.starts_at) : defaultStartInput())
  const [endValue, setEndValue] = useState(() => {
    if (initialMeeting) return toJakartaInput(initialMeeting.ends_at)
    const start = new Date(`${defaultStartInput()}:00+07:00`)
    return toJakartaInput(new Date(start.getTime() + 60 * 60 * 1000).toISOString())
  })
  const [query, setQuery] = useState('')
  const [department, setDepartment] = useState('')
  const [position, setPosition] = useState('')
  const [directory, setDirectory] = useState<WorkspaceProfile[]>([])
  const [directoryOptions, setDirectoryOptions] = useState<WorkspaceProfile[]>([])
  const [selected, setSelected] = useState<WorkspaceProfile[]>(initialParticipants)
  const [loadingDirectory, setLoadingDirectory] = useState(true)
  const [directoryError, setDirectoryError] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    let firstLoad = true
    const loadDirectory = async () => {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (department) params.set('department', department)
      if (position) params.set('position', position)
      try {
        const profiles = await meetingRequest<WorkspaceProfile[]>(`/api/profiles?${params.toString()}`)
        if (active) {
          const otherProfiles = profiles.filter(profile =>
            profile.user_id !== currentUserId && profile.user_id !== initialMeeting?.organizer_id,
          )
          setDirectory(otherProfiles)
          setSelected(current => current.map(item => otherProfiles.find(profile => profile.user_id === item.user_id) || item))
          if (!query && !department && !position) setDirectoryOptions(otherProfiles)
          setDirectoryError('')
        }
      } catch (cause) {
        if (active) setDirectoryError(cause instanceof Error ? cause.message : 'Daftar peserta tidak dapat dimuat.')
      } finally {
        if (active && firstLoad) {
          firstLoad = false
          setLoadingDirectory(false)
        }
      }
    }
    const timer = window.setTimeout(() => void loadDirectory(), query || department || position ? 250 : 0)
    const refresh = window.setInterval(() => void loadDirectory(), 30000)
    return () => {
      active = false
      window.clearTimeout(timer)
      window.clearInterval(refresh)
    }
  }, [currentUserId, department, initialMeeting?.organizer_id, position, query])

  useEffect(() => {
    if (initialMeeting) return
    const start = defaultStartInput()
    setStartValue(start)
    setEndValue(toJakartaInput(new Date(new Date(`${start}:00+07:00`).getTime() + 60 * 60 * 1000).toISOString()))
  }, [initialMeeting])

  const departments = useMemo(() => [...new Set(directoryOptions.map(profile => profile.department).filter(Boolean))].sort(), [directoryOptions])
  const positions = useMemo(() => [...new Set(directoryOptions.map(profile => profile.position).filter(Boolean))].sort(), [directoryOptions])

  function toggleParticipant(profile: WorkspaceProfile) {
    setSelected(current => {
      if (current.some(item => item.user_id === profile.user_id)) return current.filter(item => item.user_id !== profile.user_id)
      if (current.length >= 100) {
        setError('Maksimal 100 peserta dapat dipilih.')
        return current
      }
      setError('')
      return [...current, profile]
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setError('')
    if (!title.trim()) {
      setError('Judul meeting wajib diisi.')
      return
    }
    if (!selected.length) {
      setError('Pilih setidaknya satu peserta meeting.')
      return
    }
    let startsAt: string
    let endsAt: string
    try {
      startsAt = fromJakartaInput(startValue)
      endsAt = fromJakartaInput(endValue)
    } catch {
      setError('Tanggal dan waktu meeting tidak valid.')
      return
    }
    if (new Date(startsAt).getTime() <= Date.now()) {
      setError('Waktu mulai harus berada di masa mendatang.')
      return
    }
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setError('Waktu selesai harus setelah waktu mulai.')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: 'Asia/Jakarta',
        location: location.trim(),
        meeting_type: meetingType,
        participant_ids: selected.map(profile => profile.user_id),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Meeting tidak dapat disimpan.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <section className="rounded-2xl border bg-card p-5 sm:p-6">
        <h2 className="text-sm font-semibold">Informasi meeting</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs font-medium sm:col-span-2">
            Judul meeting
            <input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="Contoh: Weekly product sync" className="rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium sm:col-span-2">
            Deskripsi / agenda
            <textarea maxLength={12000} rows={4} value={description} onChange={event => setDescription(event.target.value)} placeholder="Tuliskan tujuan dan agenda meeting..." className="resize-y rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium">
            Tanggal dan waktu mulai (Asia/Jakarta)
            <input required type="datetime-local" value={startValue} onChange={event => setStartValue(event.target.value)} className="rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium">
            Tanggal dan waktu selesai
            <input required type="datetime-local" value={endValue} onChange={event => setEndValue(event.target.value)} className="rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium">
            Organizer
            <input readOnly value={initialMeeting?.organizer?.full_name || initialMeeting?.organizer?.email || 'Anda (akun yang sedang login)'} className="cursor-not-allowed rounded-lg border bg-muted px-3 py-2.5 text-sm text-muted-foreground" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium">
            Tipe meeting
            <select value={meetingType} onChange={event => setMeetingType(event.target.value)} className="rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="team">Internal / tim</option>
              <option value="client">Klien</option>
              <option value="interview">Wawancara</option>
              <option value="other">Lainnya</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium sm:col-span-2">
            Lokasi (opsional)
            <input maxLength={500} value={location} onChange={event => setLocation(event.target.value)} placeholder="Contoh: Ruang rapat / tautan lokasi" className="rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-sm font-semibold">Peserta meeting</h2><p className="mt-1 text-xs text-muted-foreground">Undangan email akan dikirim melalui Google Calendar.</p></div>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">{selected.length} dipilih</span>
        </div>

        {selected.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {selected.map(profile => (
              <span key={profile.user_id} className="inline-flex items-center gap-2 rounded-full border bg-background py-1 pl-1 pr-2 text-[11px]">
                {profile.profile_photo_url ? <img src={profile.profile_photo_url} alt="" className="size-6 rounded-full object-cover" /> : <span className="flex size-6 items-center justify-center rounded-full bg-muted font-medium">{avatarInitial(profile)}</span>}
                <span className="max-w-40 truncate">{profile.full_name || profile.email}</span>
                <button type="button" onClick={() => toggleParticipant(profile)} aria-label={`Hapus ${profile.full_name || profile.email}`} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted"><X className="size-3" /></button>
              </span>
            ))}
          </div>
        )}

        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_180px]">
          <label className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari nama atau email" className="w-full rounded-lg border bg-background py-2.5 pl-9 pr-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          <select aria-label="Filter departemen" value={department} onChange={event => setDepartment(event.target.value)} className="rounded-lg border bg-background px-3 py-2.5 text-xs">
            <option value="">Semua departemen</option>
            {departments.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Filter jabatan" value={position} onChange={event => setPosition(event.target.value)} className="rounded-lg border bg-background px-3 py-2.5 text-xs">
            <option value="">Semua jabatan</option>
            {positions.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>

        <div className="mt-3 max-h-[360px] overflow-y-auto rounded-xl border">
          {loadingDirectory ? (
            <div className="flex items-center justify-center gap-2 p-8 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Memuat daftar user...</div>
          ) : directory.length ? directory.map(profile => {
            const checked = selected.some(item => item.user_id === profile.user_id)
            return (
              <label key={profile.user_id} className="flex cursor-pointer items-center gap-3 border-b p-3 last:border-b-0 hover:bg-muted/50">
                <input type="checkbox" checked={checked} onChange={() => toggleParticipant(profile)} className="size-4 accent-primary" />
                {profile.profile_photo_url
                  ? <img src={profile.profile_photo_url} alt="" className="size-9 shrink-0 rounded-full object-cover" />
                  : <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{avatarInitial(profile)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 truncate text-xs font-semibold">
                    {profile.full_name || 'Nama belum diatur'}
                    <span className={`size-2 shrink-0 rounded-full ${profile.online_status === 'online' ? 'bg-emerald-500' : 'bg-zinc-400'}`} title={profile.online_status === 'online' ? 'Online' : 'Offline'} />
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{profile.email}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{[profile.position, profile.department].filter(Boolean).join(' · ') || 'Jabatan dan departemen belum diatur'}</span>
                </span>
                <span className={`hidden text-[10px] sm:inline ${profile.online_status === 'online' ? 'text-emerald-700' : 'text-muted-foreground'}`}>
                  {profile.online_status === 'online' ? 'Online' : 'Offline'}
                </span>
              </label>
            )
          }) : (
            <div className="p-8 text-center text-xs text-muted-foreground"><UsersRound className="mx-auto mb-2 size-5" />Tidak ada user yang cocok dengan filter.</div>
          )}
        </div>
        {directoryError && <p role="alert" className="mt-3 text-xs text-red-700">{directoryError}</p>}
      </section>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}
      <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
        <button type="button" onClick={onCancel} disabled={submitting} className="rounded-lg border px-4 py-2.5 text-xs font-semibold hover:bg-muted disabled:opacity-50">Batal</button>
        <button type="submit" disabled={submitting || loadingDirectory} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          {submitting && <LoaderCircle className="size-4 animate-spin" />}
          {submitting ? 'Menyimpan...' : submitLabel}
        </button>
      </div>
    </form>
  )
}
