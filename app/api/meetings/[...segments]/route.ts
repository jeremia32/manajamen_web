import { NextResponse } from 'next/server'
import { forwardMeetingRequest } from '@/lib/meeting-proxy'

type RouteContext = { params: Promise<{ segments: string[] }> }

function callbackRedirect(request: Request, message: string, connected = false) {
  const url = new URL('/meetings', request.url)
  if (connected) url.searchParams.set('calendar', 'connected')
  else url.searchParams.set('calendarError', message)
  const response = NextResponse.redirect(url)
  response.cookies.set('meeting_google_oauth_state', '', { path: '/', maxAge: 0 })
  return response
}

async function handle(request: Request, context: RouteContext) {
  const { segments } = await context.params
  const path = segments.join('/')

  if (path === 'calendar/auth/callback' && request.method === 'GET') {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const providerError = url.searchParams.get('error_description') || url.searchParams.get('error')
    const stateCookie = request.headers.get('cookie')?.match(/(?:^|;\s*)meeting_google_oauth_state=([^;]*)/)?.[1]
    if (providerError) return callbackRedirect(request, 'Google membatalkan atau menolak akses kalender.')
    if (!code || !state || stateCookie !== state) {
      return callbackRedirect(request, 'Sesi OAuth Google tidak valid atau kedaluwarsa. Coba hubungkan ulang.')
    }

    const backendUrl = process.env.LANGGRAPH_API_URL
    if (!backendUrl) return callbackRedirect(request, 'Backend meeting belum dikonfigurasi.')
    try {
      const response = await fetch(`${backendUrl.replace(/\/+$/, '')}/meetings/calendar/auth/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state }),
        cache: 'no-store',
      })
      const result = await response.json()
      if (!response.ok || !result.connected) {
        return callbackRedirect(request, result.detail || result.error || 'Tidak dapat menghubungkan Google Calendar.')
      }
      return callbackRedirect(request, '', true)
    } catch {
      return callbackRedirect(request, 'Backend meeting tidak dapat dihubungi.')
    }
  }

  return forwardMeetingRequest(
    request,
    `meetings/${segments.map(segment => encodeURIComponent(segment)).join('/')}`,
  )
}

export const GET = handle
export const POST = handle
export const PATCH = handle
export const DELETE = handle
