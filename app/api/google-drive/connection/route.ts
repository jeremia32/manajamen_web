import { NextResponse } from 'next/server'
import { forwardGoogleDrive } from '@/lib/google-drive-proxy'

export async function GET(request: Request) {
  return forwardGoogleDrive(request, '/google-drive/connection')
}

export async function DELETE(request: Request) {
  const response = await forwardGoogleDrive(request, '/google-drive/connection', 'DELETE')
  const result = await response.json()
  const nextResponse = NextResponse.json(result, { status: response.status })
  if (response.ok) {
    nextResponse.cookies.set('google_drive_session_id', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
  }
  return nextResponse
}
