'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, LoaderCircle } from 'lucide-react'
import { HutabyteShell, PageHeading } from '@/components/hutabyte-shell'
import { MeetingForm } from '@/components/meeting-form'
import { meetingRequest, type MeetingInput } from '@/lib/meetings-client'

type ProfileResponse = { user_id: string }
type CalendarConnection = { connected: boolean }

export default function NewMeetingPage() {
  const router = useRouter()
  const [userId, setUserId] = useState('')
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void Promise.all([
      meetingRequest<ProfileResponse>('/api/profile'),
      meetingRequest<CalendarConnection>('/api/meetings/calendar/connection'),
    ]).then(([profile, connection]) => {
      if (active) {
        setUserId(profile.user_id)
        setCalendarConnected(connection.connected)
      }
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Informasi akun tidak dapat dimuat.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function createMeeting(payload: MeetingInput) {
    const meeting = await meetingRequest<{ id: string }>('/api/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    router.replace(`/meetings/${meeting.id}`)
  }

  return (
    <HutabyteShell>
      <div className="mx-auto max-w-[900px] px-5 py-10 sm:px-8 lg:px-12">
        <Link href="/meetings" className="mb-5 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Kembali ke meeting</Link>
        <PageHeading eyebrow="Google Calendar dan Meet" title="Buat meeting" description="Jadwalkan waktu, susun agenda, dan undang rekan kerja." />
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border bg-card p-6 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Memuat akun workspace...</div>
        ) : !calendarConnected ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Kalender Google workspace belum terhubung. Minta admin workspace menghubungkannya dari halaman Meeting Management.
            {error && <p role="alert" className="mt-2 text-xs">{error}</p>}
          </div>
        ) : (
          <MeetingForm
            currentUserId={userId}
            submitLabel="Buat meeting dan kirim undangan"
            onCancel={() => router.back()}
            onSubmit={createMeeting}
          />
        )}
        {error && calendarConnected && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}
      </div>
    </HutabyteShell>
  )
}
