'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Clock3,
  LoaderCircle,
  MapPin,
  Pencil,
  Search,
  UserPlus,
  UsersRound,
  Video,
  X,
} from 'lucide-react'
import { HutabyteShell, PageHeading } from '@/components/hutabyte-shell'
import { MeetingForm } from '@/components/meeting-form'
import {
  formatMeetingDate,
  formatMeetingTime,
  meetingDuration,
  meetingRequest,
  type Meeting,
  type MeetingInput,
  type MeetingParticipant,
  type WorkspaceProfile,
} from '@/lib/meetings-client'

type UserProfile = { user_id: string }
type CalendarConnection = { can_manage: boolean }

const invitationLabels = {
  invited: 'Menunggu respons',
  accepted: 'Diterima',
  declined: 'Ditolak',
}

function initials(profile: WorkspaceProfile) {
  return (profile.full_name || profile.email || '?').slice(0, 1).toUpperCase()
}

function Avatar({ profile, size = 'size-10' }: { profile: WorkspaceProfile; size?: string }) {
  return profile.profile_photo_url
    ? <img src={profile.profile_photo_url} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
    : <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold`}>{initials(profile)}</span>
}

function AddParticipants({
  existingIds,
  onAdd,
  onCancel,
}: {
  existingIds: string[]
  onAdd: (ids: string[]) => Promise<void>
  onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const [profiles, setProfiles] = useState<WorkspaceProfile[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      meetingRequest<WorkspaceProfile[]>(`/api/profiles?${params}`)
        .then(result => {
          if (active) {
            setProfiles(result.filter(profile => !existingIds.includes(profile.user_id)))
            setError('')
          }
        })
        .catch(cause => {
          if (active) setError(cause instanceof Error ? cause.message : 'Daftar user tidak dapat dimuat.')
        })
        .finally(() => { if (active) setLoading(false) })
    }, query ? 250 : 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [existingIds, query])

  async function submit() {
    if (!selected.length || saving) return
    setSaving(true)
    try {
      await onAdd(selected)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Peserta tidak dapat ditambahkan.')
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border bg-muted/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="text-xs font-semibold">Tambah peserta</h3><p className="mt-1 text-[11px] text-muted-foreground">Undangan email akan dikirim melalui Google Calendar.</p></div>
        <button type="button" onClick={onCancel} aria-label="Tutup tambah peserta" className="rounded-md p-1 hover:bg-muted"><X className="size-4" /></button>
      </div>
      <label className="relative mt-3 block">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari nama atau email" className="w-full rounded-lg border bg-background py-2.5 pl-9 pr-3 text-xs" />
      </label>
      <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border bg-background">
        {loading ? <div className="p-5 text-center text-xs text-muted-foreground"><LoaderCircle className="mx-auto mb-2 size-4 animate-spin" />Memuat user...</div>
          : profiles.length ? profiles.map(profile => (
            <label key={profile.user_id} className="flex cursor-pointer items-center gap-2.5 border-b p-2.5 last:border-0 hover:bg-muted/50">
              <input type="checkbox" checked={selected.includes(profile.user_id)} onChange={() => setSelected(current => current.includes(profile.user_id) ? current.filter(id => id !== profile.user_id) : [...current, profile.user_id])} className="size-4 accent-primary" />
              <Avatar profile={profile} size="size-8" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 truncate text-[11px] font-semibold">{profile.full_name || profile.email}<span className={`size-2 rounded-full ${profile.online_status === 'online' ? 'bg-emerald-500' : 'bg-zinc-400'}`} /></span>
                <span className="block truncate text-[10px] text-muted-foreground">{profile.email} · {[profile.position, profile.department].filter(Boolean).join(' / ')}</span>
              </span>
            </label>
          )) : <p className="p-5 text-center text-xs text-muted-foreground">Tidak ada user yang dapat ditambahkan.</p>}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
      <div className="mt-3 flex justify-end">
        <button type="button" onClick={() => void submit()} disabled={!selected.length || saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
          Tambahkan {selected.length ? `(${selected.length})` : ''}
        </button>
      </div>
    </section>
  )
}

export default function MeetingDetail({ meetingId }: { meetingId: string }) {
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [canManageSharedCalendar, setCanManageSharedCalendar] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [addingParticipants, setAddingParticipants] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const [meetingResult, profileResult, connection] = await Promise.all([
          meetingRequest<Meeting>(`/api/meetings/${meetingId}`),
          meetingRequest<UserProfile>('/api/profile'),
          meetingRequest<CalendarConnection>('/api/meetings/calendar/connection'),
        ])
        if (active) {
          setMeeting(meetingResult)
          setProfile(profileResult)
          setCanManageSharedCalendar(connection.can_manage)
          setError('')
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Detail meeting tidak dapat dimuat.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 30000)
    return () => { active = false; window.clearInterval(timer) }
  }, [meetingId])

  const participants = meeting?.participants || []
  const currentParticipant = participants.find(participant => participant.user_id === profile?.user_id)
  const canManage = Boolean(profile && meeting && (
    meeting.organizer_id === profile.user_id || canManageSharedCalendar
  ))
  const existingParticipantIds = useMemo(
    () => [...participants.map(participant => participant.user_id), ...(meeting?.organizer_id ? [meeting.organizer_id] : [])],
    [meeting?.organizer_id, participants],
  )

  async function respond(invitationStatus: 'accepted' | 'declined') {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await meetingRequest<Meeting>(`/api/meetings/${meetingId}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitation_status: invitationStatus }),
      })
      setMeeting(result)
      setMessage(invitationStatus === 'accepted' ? 'Undangan diterima.' : 'Undangan ditolak.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Respons undangan tidak dapat disimpan.')
    } finally {
      setBusy(false)
    }
  }

  async function updateMeeting(payload: MeetingInput) {
    const result = await meetingRequest<Meeting>(`/api/meetings/${meetingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setMeeting(result)
    setEditing(false)
    setMessage('Meeting berhasil diperbarui dan peserta sudah diberi tahu.')
  }

  async function cancelMeeting() {
    if (!window.confirm('Batalkan meeting ini? Peserta akan menerima pembaruan dari Google Calendar.')) return
    setBusy(true)
    setError('')
    try {
      const result = await meetingRequest<Meeting>(`/api/meetings/${meetingId}/cancel`, { method: 'POST' })
      setMeeting(result)
      setMessage('Meeting berhasil dibatalkan.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Meeting tidak dapat dibatalkan.')
    } finally {
      setBusy(false)
    }
  }

  async function addParticipants(ids: string[]) {
    const result = await meetingRequest<Meeting>(`/api/meetings/${meetingId}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids),
    })
    setMeeting(result)
    setAddingParticipants(false)
    setMessage('Peserta berhasil ditambahkan dan undangan sudah dikirim.')
  }

  async function updateAttendance(participantId: string, attendanceStatus: 'pending' | 'attended' | 'absent') {
    setBusy(true)
    setError('')
    try {
      const result = await meetingRequest<Meeting>(`/api/meetings/${meetingId}/participants/${participantId}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendance_status: attendanceStatus }),
      })
      setMeeting(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kehadiran tidak dapat diperbarui.')
    } finally {
      setBusy(false)
    }
  }

  const organizer = meeting?.organizer

  return (
    <HutabyteShell>
      <div className="mx-auto max-w-[1000px] px-5 py-10 sm:px-8 lg:px-12">
        <Link href="/meetings" className="mb-5 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Kembali ke meeting</Link>
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border bg-card p-6 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Memuat detail meeting...</div>
        ) : !meeting ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error || 'Meeting tidak ditemukan.'}</p>
        ) : editing ? (
          <>
            <PageHeading eyebrow="Edit meeting" title="Ubah jadwal meeting" description="Perubahan jadwal akan diperbarui pada Google Calendar dan peserta akan diberi tahu." />
            <MeetingForm
              initialMeeting={meeting}
              initialParticipants={participants}
              currentUserId={profile?.user_id || ''}
              submitLabel="Simpan perubahan"
              onCancel={() => setEditing(false)}
              onSubmit={updateMeeting}
            />
          </>
        ) : (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <PageHeading eyebrow="Detail meeting" title={meeting.title} />
              <div className="mb-8 flex flex-wrap gap-2 sm:justify-end">
                {canManage && meeting.status === 'scheduled' && (
                  <>
                    <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted"><Pencil className="size-3.5" />Edit</button>
                    <button type="button" onClick={() => setAddingParticipants(value => !value)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted"><UserPlus className="size-3.5" />Tambah peserta</button>
                    <button type="button" onClick={() => void cancelMeeting()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"><X className="size-3.5" />Batalkan</button>
                  </>
                )}
              </div>
            </div>

            {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}
            {message && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{message}</p>}
            {addingParticipants && meeting.status === 'scheduled' && canManage && (
              <div className="mb-5">
                <AddParticipants existingIds={existingParticipantIds} onAdd={addParticipants} onCancel={() => setAddingParticipants(false)} />
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(270px,0.8fr)]">
              <div className="space-y-5">
                <section className="rounded-2xl border bg-card p-5 sm:p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      meeting.status === 'cancelled' ? 'bg-red-100 text-red-700'
                        : meeting.status === 'ongoing' ? 'bg-emerald-100 text-emerald-700'
                          : meeting.status === 'completed' ? 'bg-muted text-muted-foreground'
                            : 'bg-blue-100 text-blue-700'
                    }`}>{meeting.status === 'scheduled' ? 'Terjadwal' : meeting.status === 'ongoing' ? 'Sedang berlangsung' : meeting.status === 'completed' ? 'Selesai' : 'Dibatalkan'}</span>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] capitalize">{meeting.meeting_type}</span>
                  </div>
                  {meeting.description && <div className="mt-5"><h2 className="text-xs font-semibold">Agenda / deskripsi</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{meeting.description}</p></div>}
                  <div className="mt-5 grid gap-4 border-t pt-5 sm:grid-cols-2">
                    <div className="flex items-start gap-2.5"><CalendarDays className="mt-0.5 size-4 text-primary" /><div><p className="text-xs font-medium">{formatMeetingDate(meeting.starts_at)}</p><p className="mt-1 text-[11px] text-muted-foreground">Zona waktu {meeting.timezone}</p></div></div>
                    <div className="flex items-start gap-2.5"><Clock3 className="mt-0.5 size-4 text-primary" /><div><p className="text-xs font-medium">{formatMeetingTime(meeting.starts_at)}–{formatMeetingTime(meeting.ends_at)}</p><p className="mt-1 text-[11px] text-muted-foreground">{meetingDuration(meeting.starts_at, meeting.ends_at)}</p></div></div>
                    <div className="flex items-start gap-2.5"><UsersRound className="mt-0.5 size-4 text-primary" /><div><p className="text-xs font-medium">Organizer</p><p className="mt-1 text-[11px] text-muted-foreground">{organizer?.full_name || organizer?.email || 'User workspace'}</p></div></div>
                    {meeting.location && <div className="flex items-start gap-2.5"><MapPin className="mt-0.5 size-4 text-primary" /><div><p className="text-xs font-medium">Lokasi</p><p className="mt-1 text-[11px] text-muted-foreground">{meeting.location}</p></div></div>}
                  </div>
                </section>

                <section className="rounded-2xl border bg-card p-5 sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div><h2 className="text-sm font-semibold">Peserta</h2><p className="mt-1 text-xs text-muted-foreground">{participants.length} orang diundang</p></div>
                    {currentParticipant && (
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${currentParticipant.invitation_status === 'accepted' ? 'bg-emerald-100 text-emerald-700' : currentParticipant.invitation_status === 'declined' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                        {invitationLabels[currentParticipant.invitation_status]}
                      </span>
                    )}
                  </div>
                  <div className="mt-4 divide-y">
                    {participants.length ? participants.map(participant => (
                      <div key={participant.user_id} className="flex flex-wrap items-center gap-3 py-3">
                        <div className="relative">
                          <Avatar profile={participant} />
                          <span className={`absolute bottom-0 right-0 size-3 rounded-full border-2 border-card ${participant.online_status === 'online' ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold">{participant.full_name || participant.email}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{participant.email}</p>
                          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{[participant.position, participant.department].filter(Boolean).join(' · ') || 'Jabatan/departemen belum diatur'} · {participant.online_status === 'online' ? 'Online' : 'Offline'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-1 text-[10px] ${
                            participant.invitation_status === 'accepted' ? 'bg-emerald-100 text-emerald-700' : participant.invitation_status === 'declined' ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground'
                          }`}>{invitationLabels[participant.invitation_status]}</span>
                          {canManage && meeting.status !== 'cancelled' && (
                            <select
                              aria-label={`Kehadiran ${participant.full_name || participant.email}`}
                              value={participant.attendance_status}
                              disabled={busy}
                              onChange={event => {
                                const value = event.target.value
                                if (value === 'pending' || value === 'attended' || value === 'absent') void updateAttendance(participant.user_id, value)
                              }}
                              className="rounded-md border bg-background px-2 py-1 text-[10px]"
                            >
                              <option value="pending">Belum hadir</option><option value="attended">Hadir</option><option value="absent">Tidak hadir</option>
                            </select>
                          )}
                        </div>
                      </div>
                    )) : <p className="py-6 text-center text-xs text-muted-foreground">Belum ada peserta lain yang diundang.</p>}
                  </div>
                  {currentParticipant && meeting.status !== 'cancelled' && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                      <button type="button" disabled={busy} onClick={() => void respond('accepted')} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><Check className="size-3.5" />Terima undangan</button>
                      <button type="button" disabled={busy} onClick={() => void respond('declined')} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50"><X className="size-3.5" />Tolak</button>
                    </div>
                  )}
                </section>
              </div>

              <aside className="space-y-4">
                <section className="rounded-2xl bg-[#20206f] p-5 text-white">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-white/10"><Video className="size-5" /></div>
                  <h2 className="mt-4 text-sm font-semibold">Google Meet</h2>
                  <p className="mt-1 break-all text-[11px] leading-5 text-indigo-100/75">{meeting.google_meet_link}</p>
                  {meeting.status !== 'cancelled' ? (
                    <a href={meeting.google_meet_link} target="_blank" rel="noreferrer" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-3 py-2.5 text-xs font-semibold text-[#20206f] hover:bg-indigo-50">Gabung Google Meet <Video className="size-3.5" /></a>
                  ) : <p className="mt-4 rounded-lg bg-white/10 px-3 py-2 text-center text-xs">Meeting dibatalkan</p>}
                </section>
                {organizer && (
                  <section className="rounded-2xl border bg-card p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Dijadwalkan oleh</p>
                    <div className="mt-3 flex items-center gap-3"><Avatar profile={organizer} /><div className="min-w-0"><p className="truncate text-xs font-semibold">{organizer.full_name || organizer.email}</p><p className="truncate text-[11px] text-muted-foreground">{organizer.position || 'Organizer'}{organizer.department ? ` · ${organizer.department}` : ''}</p></div></div>
                  </section>
                )}
                <Link href="/meetings" className="inline-flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />Semua meeting</Link>
              </aside>
            </div>
          </>
        )}
      </div>
    </HutabyteShell>
  )
}
