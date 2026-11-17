import { NextResponse } from 'next/server'
import { forwardMicrosoft } from '@/lib/microsoft-proxy'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const microsoftError = url.searchParams.get('error_description') || url.searchParams.get('error')

  if (microsoftError || !code || !state) {
    const message = microsoftError || 'Microsoft tidak mengembalikan authorization code.'
    return NextResponse.redirect(new URL(`/teams?error=${encodeURIComponent(message)}`, request.url))
  }

  const response = await forwardMicrosoft(request, '/microsoft/auth/callback', 'POST', { code, state })
  const result = await response.json()
  if (!response.ok || !result.connectionId) {
    return NextResponse.redirect(new URL(`/teams?error=${encodeURIComponent(result.detail || 'Login Microsoft gagal.')}`, request.url))
  }

  const redirect = NextResponse.redirect(new URL('/teams?connected=1', request.url))
  redirect.cookies.set('microsoft_session_id', result.connectionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
  return redirect
}
