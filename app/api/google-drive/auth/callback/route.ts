import { NextResponse } from 'next/server'
import { forwardGoogleDrive } from '@/lib/google-drive-proxy'

function analyzerRedirect(request: Request, message: string) {
  const redirect = NextResponse.redirect(new URL(`/analyzer?googleDriveError=${encodeURIComponent(message)}`, request.url))
  redirect.cookies.set('google_drive_oauth_state', '', { path: '/', maxAge: 0 })
  return redirect
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const googleError = url.searchParams.get('error_description') || url.searchParams.get('error')
  const stateCookie = request.headers.get('cookie')?.match(/(?:^|;\s*)google_drive_oauth_state=([^;]*)/)?.[1]

  if (googleError) return analyzerRedirect(request, 'Google membatalkan atau menolak izin Drive.')
  if (!code || !state || stateCookie !== state) {
    return analyzerRedirect(request, 'Sesi OAuth Google tidak valid atau kedaluwarsa. Coba hubungkan ulang.')
  }

  const response = await forwardGoogleDrive(request, '/google-drive/auth/callback', 'POST', { code, state })
  const result = await response.json()
  if (!response.ok || !result.connectionId) {
    return analyzerRedirect(request, result.detail || 'Login Google Drive gagal.')
  }

  const redirect = NextResponse.redirect(new URL('/analyzer?googleDrive=connected', request.url))
  redirect.cookies.set('google_drive_session_id', result.connectionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  redirect.cookies.set('google_drive_oauth_state', '', { path: '/', maxAge: 0 })
  return redirect
}
