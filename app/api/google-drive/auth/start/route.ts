import { NextResponse } from 'next/server'
import { forwardGoogleDrive } from '@/lib/google-drive-proxy'

export async function POST(request: Request) {
  const response = await forwardGoogleDrive(request, '/google-drive/auth/start', 'POST')
  const result = await response.json()
  const nextResponse = NextResponse.json(result, { status: response.status })
  if (response.ok && result.state) {
    nextResponse.cookies.set('google_drive_oauth_state', result.state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10,
    })
  }
  return nextResponse
}
