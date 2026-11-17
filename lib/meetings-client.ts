import { authenticatedFetch, readApiResponse } from '@/lib/supabase-browser'

export type WorkspaceProfile = {
  user_id: string
  email: string
  full_name: string
  profile_photo_url: string | null
  position: string
  department: string
  account_status?: string
  last_seen_at?: string | null
  online_status: 'online' | 'offline'
}

export type MeetingParticipant = WorkspaceProfile & {
  invitation_status: 'invited' | 'accepted' | 'declined'
  attendance_status: 'pending' | 'attended' | 'absent'
}

export type Meeting = {
  id: string
  title: string
  description: string
  organizer_id: string
  organizer: WorkspaceProfile | null
  starts_at: string
  ends_at: string
  timezone: string
  location: string
  meeting_type: string
  google_calendar_event_id: string
  google_meet_link: string
  status: 'scheduled' | 'ongoing' | 'completed' | 'cancelled'
  participant_count: number
  participants?: MeetingParticipant[]
}

export type MeetingInput = {
  title: string
  description: string
  starts_at: string
  ends_at: string
  timezone: string
  location: string
  meeting_type: string
  participant_ids: string[]
}

export async function meetingRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await authenticatedFetch(path, { cache: 'no-store', ...init })
  return readApiResponse<T>(response, 'Permintaan meeting gagal.')
}

export function getJakartaDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function toJakartaInput(value: string): string {
  const date = new Date(value)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}

export function fromJakartaInput(value: string): string {
  return new Date(`${value}:00+07:00`).toISOString()
}

export function formatMeetingDate(value: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'full',
  }).format(new Date(value))
}

export function formatMeetingTime(value: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function formatMeetingDateTime(value: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function meetingDuration(startsAt: string, endsAt: string): string {
  const minutes = Math.max(0, Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000))
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (!hours) return `${remainingMinutes} menit`
  return remainingMinutes ? `${hours} jam ${remainingMinutes} menit` : `${hours} jam`
}
