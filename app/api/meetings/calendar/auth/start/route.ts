import { NextResponse } from 'next/server'
import { forwardMeetingRequest } from '@/lib/meeting-proxy'

export async function POST(request: Request) {
  const response = await forwardMeetingRequest(request, 'meetings/calendar/auth/start')
  const result = await response.json()
  const nextResponse = NextResponse.json(result, { status: response.status })
  if (response.ok && result.state) {
    nextResponse.cookies.set('meeting_google_oauth_state', result.state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10,
    })
  }
  return nextResponse
}
