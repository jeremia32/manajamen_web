'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, LoaderCircle, Plus, RefreshCw, Video } from 'lucide-react'
import { HutabyteShell, PageHeading } from '@/components/hutabyte-shell'
import { MeetingCard } from '@/components/meeting-card'
import {
  getJakartaDateKey,
  meetingRequest,
  type Meeting,
} from '@/lib/meetings-client'

type CalendarConnection = {
  connected: boolean
  can_manage: boolean
  calendar: { email: string; display_name: string } | null
}

type Tab = 'upcoming' | 'today' | 'past' | 'cancelled'

const tabs: { value: Tab; label: string }[] = [
  { value: 'upcoming', label: 'Akan datang' },
  { value: 'today', label: 'Hari ini' },
  { value: 'past', label: 'Selesai' },
  { value: 'cancelled', label: 'Dibatalkan' },
]

function monthDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [connection, setConnection] = useState<CalendarConnection | null>(null)
  const [tab, setTab] = useState<Tab>('upcoming')
  const [today] = useState(() => getJakartaDateKey(new Date()))
  const [selectedDate, setSelectedDate] = useState(today)
  const [month, setMonth] = useState(() => {
    const [year, value] = today.split('-').map(Number)
    return { year, month: value - 1 }
  })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [calendarMessage, setCalendarMessage] = useState('')

  async function loadData() {
    const [meetingRows, calendar] = await Promise.all([
      meetingRequest<Meeting[]>('/api/meetings'),
      meetingRequest<CalendarConnection>('/api/meetings/calendar/connection'),
    ])
    setMeetings(meetingRows)
    setConnection(calendar)
  }

  useEffect(() => {
    let active = true
    const run = async () => {
      try {
        const [meetingRows, calendar] = await Promise.all([
          meetingRequest<Meeting[]>('/api/meetings'),
          meetingRequest<CalendarConnection>('/api/meetings/calendar/connection'),
        ])
        if (active) {
          setMeetings(meetingRows)
          setConnection(calendar)
          setError('')
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Data meeting tidak dapat dimuat.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void run()
    const timer = window.setInterval(() => void run(), 60000)
    const query = new URLSearchParams(window.location.search)
    if (query.get('calendar') === 'connected') setCalendarMessage('Kalender Google workspace berhasil dihubungkan.')
    if (query.get('calendarError')) setCalendarMessage(query.get('calendarError') || '')
    if (query.has('calendar') || query.has('calendarError')) window.history.replaceState(null, '', '/meetings')
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  const categorized = useMemo(() => {
    const now = Date.now()
    return {
      upcoming: meetings.filter(meeting =>
        meeting.status === 'scheduled'
        && new Date(meeting.starts_at).getTime() > now
        && getJakartaDateKey(meeting.starts_at) > today,
      ),
      today: meetings.filter(meeting =>
        getJakartaDateKey(meeting.starts_at) === today && meeting.status !== 'cancelled',
      ),
      past: meetings.filter(meeting =>
        getJakartaDateKey(meeting.starts_at) < today && meeting.status !== 'cancelled',
      ),
      cancelled: meetings.filter(meeting => meeting.status === 'cancelled'),
    }
  }, [meetings, today])

  const visibleMeetings = categorized[tab]
  const [year, monthNumber, day] = selectedDate.split('-').map(Number)
  const offset = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, monthNumber, 0).getDate()
  const selectedMeetings = meetings.filter(meeting =>
    getJakartaDateKey(meeting.starts_at) === selectedDate && meeting.status !== 'cancelled',
  )

  async function connectCalendar() {
    setBusy(true)
    setError('')
    try {
      const result = await meetingRequest<{ authorization_url: string }>('/api/meetings/calendar/auth/start', { method: 'POST' })
      window.location.assign(result.authorization_url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tidak dapat memulai koneksi Google Calendar.')
      setBusy(false)
    }
  }

  async function disconnectCalendar() {
    if (!window.confirm('Putuskan koneksi kalender Google workspace? Meeting yang sudah dibuat tetap ada di kalender Google.')) return
    setBusy(true)
    setError('')
    try {
      await meetingRequest<{ disconnected: boolean }>('/api/meetings/calendar/connection', { method: 'DELETE' })
      await loadData()
      setCalendarMessage('Kalender Google workspace sudah diputuskan.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Koneksi kalender tidak dapat diputuskan.')
    } finally {
      setBusy(false)
    }
  }

  function changeMonth(delta: number) {
    const date = new Date(month.year, month.month + delta, 1)
    setMonth({ year: date.getFullYear(), month: date.getMonth() })
    setSelectedDate(monthDateKey(date.getFullYear(), date.getMonth(), 1))
  }

  const monthLabel = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' })
    .format(new Date(month.year, month.month, 15))

  return (
    <HutabyteShell>
      <div className="mx-auto max-w-[1180px] px-5 py-10 sm:px-8 lg:px-12">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <PageHeading eyebrow="Workspace" title="Meeting Management" description="Jadwalkan meeting, undang peserta, dan gabung ke Google Meet." />
          <Link
            href="/meetings/new"
            aria-disabled={!connection?.connected}
            className={`mb-8 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold ${
              connection?.connected ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'pointer-events-none bg-muted text-muted-foreground'
            }`}
          >
            <Plus className="size-4" /> Buat meeting
          </Link>
        </div>

        <section className="mb-6 flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Video className="size-4" /></span>
            <div>
              <p className="text-xs font-semibold">Google Calendar workspace</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {connection?.connected
                  ? `Terhubung sebagai ${connection.calendar?.email || connection.calendar?.display_name || 'akun Google workspace'}`
                  : 'Hubungkan kalender Google bersama untuk membuat undangan dan link Google Meet.'}
              </p>
            </div>
          </div>
          {connection?.can_manage && (
            <button
              type="button"
              onClick={() => void (connection.connected ? disconnectCalendar() : connectCalendar())}
              disabled={busy}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50"
            >
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {connection.connected ? 'Putuskan kalender' : 'Hubungkan kalender'}
            </button>
          )}
        </section>
        {calendarMessage && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{calendarMessage}</p>}
        {!connection?.connected && !loading && <p className="mb-4 text-xs text-muted-foreground">Pembuatan meeting aktif setelah admin workspace menghubungkan kalender bersama.</p>}
        {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.8fr)]">
          <section className="min-w-0 rounded-2xl border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap gap-1 border-b pb-3">
              {tabs.map(item => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setTab(item.value)}
                  className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                    tab === item.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {item.label}<span className="ml-1.5 opacity-70">{categorized[item.value].length}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Memuat meeting...</div>
              ) : visibleMeetings.length ? visibleMeetings.map(meeting => <MeetingCard key={meeting.id} meeting={meeting} />) : (
                <div className="rounded-xl border border-dashed py-12 text-center">
                  <CalendarDays className="mx-auto size-6 text-muted-foreground" />
                  <p className="mt-3 text-xs font-medium">Belum ada meeting di bagian ini.</p>
                  {tab === 'upcoming' && connection?.connected && <Link href="/meetings/new" className="mt-3 inline-block text-xs font-semibold text-primary hover:underline">Jadwalkan meeting pertama</Link>}
                </div>
              )}
            </div>
          </section>

          <aside className="h-fit rounded-2xl border bg-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div><h2 className="text-sm font-semibold">Kalender meeting</h2><p className="mt-1 text-[11px] text-muted-foreground">{monthLabel}</p></div>
              <div className="flex gap-1">
                <button type="button" onClick={() => changeMonth(-1)} aria-label="Bulan sebelumnya" className="rounded-md border p-1.5 hover:bg-muted"><ChevronLeft className="size-4" /></button>
                <button type="button" onClick={() => changeMonth(1)} aria-label="Bulan berikutnya" className="rounded-md border p-1.5 hover:bg-muted"><ChevronRight className="size-4" /></button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-7 gap-1 text-center">
              {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map(dayName => <span key={dayName} className="py-2 text-[10px] font-medium text-muted-foreground">{dayName}</span>)}
              {Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}
              {Array.from({ length: daysInMonth }, (_, index) => {
                const date = monthDateKey(month.year, month.month, index + 1)
                const count = meetings.filter(meeting => meeting.status !== 'cancelled' && getJakartaDateKey(meeting.starts_at) === date).length
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => { setSelectedDate(date); setTab('today') }}
                    aria-label={`${index + 1} ${monthLabel}${count ? `, ${count} meeting` : ''}`}
                    className={`relative mx-auto flex size-9 items-center justify-center rounded-full text-xs transition ${
                      selectedDate === date ? 'bg-primary font-semibold text-primary-foreground'
                        : date === today ? 'border border-primary text-primary'
                          : 'hover:bg-muted'
                    }`}
                  >
                    {index + 1}
                    {count > 0 && <span className={`absolute bottom-1 size-1 rounded-full ${selectedDate === date ? 'bg-white' : 'bg-emerald-500'}`} />}
                  </button>
                )
              })}
            </div>
            <div className="mt-4 border-t pt-4">
              <h3 className="text-xs font-semibold">{new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'full' }).format(new Date(`${selectedDate}T12:00:00+07:00`))}</h3>
              <div className="mt-3 flex flex-col gap-2">
                {selectedMeetings.length ? selectedMeetings.map(meeting => (
                  <Link key={meeting.id} href={`/meetings/${meeting.id}`} className="flex items-center gap-2 rounded-lg bg-muted/60 p-2.5 hover:bg-muted">
                    <span className="h-8 w-1 shrink-0 rounded-full bg-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium">{meeting.title}</span>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        {new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(new Date(meeting.starts_at))}
                      </span>
                    </span>
                  </Link>
                )) : <p className="py-3 text-center text-[11px] text-muted-foreground">Tidak ada meeting pada tanggal ini.</p>}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </HutabyteShell>
  )
}
