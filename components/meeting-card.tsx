import Link from 'next/link'
import { CalendarDays, Clock3, MapPin, UsersRound, Video } from 'lucide-react'
import {
  formatMeetingDate,
  formatMeetingTime,
  meetingDuration,
  type Meeting,
} from '@/lib/meetings-client'

const statusLabels: Record<Meeting['status'], string> = {
  scheduled: 'Terjadwal',
  ongoing: 'Sedang berlangsung',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
}

export function MeetingCard({ meeting }: { meeting: Meeting }) {
  return (
    <article className="rounded-xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/meetings/${meeting.id}`} className="truncate text-sm font-semibold hover:text-primary">
              {meeting.title}
            </Link>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              meeting.status === 'cancelled' ? 'bg-red-100 text-red-700'
                : meeting.status === 'ongoing' ? 'bg-emerald-100 text-emerald-700'
                  : meeting.status === 'completed' ? 'bg-muted text-muted-foreground'
                    : 'bg-blue-100 text-blue-700'
            }`}>
              {statusLabels[meeting.status]}
            </span>
          </div>
          {meeting.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{meeting.description}</p>}
        </div>
        {meeting.status !== 'cancelled' && (
          <a
            href={meeting.google_meet_link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Video className="size-3.5" /> Gabung
          </a>
        )}
      </div>
      <div className="mt-4 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
        <p className="flex items-center gap-2"><CalendarDays className="size-3.5 shrink-0" />{formatMeetingDate(meeting.starts_at)}</p>
        <p className="flex items-center gap-2"><Clock3 className="size-3.5 shrink-0" />{formatMeetingTime(meeting.starts_at)}–{formatMeetingTime(meeting.ends_at)} · {meetingDuration(meeting.starts_at, meeting.ends_at)}</p>
        <p className="flex items-center gap-2"><UsersRound className="size-3.5 shrink-0" />{meeting.organizer?.full_name || meeting.organizer?.email || 'Organizer'} · {meeting.participant_count} peserta</p>
        {meeting.location && <p className="flex items-center gap-2"><MapPin className="size-3.5 shrink-0" />{meeting.location}</p>}
      </div>
    </article>
  )
}
