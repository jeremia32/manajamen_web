import { NextResponse } from 'next/server'
import { forwardMicrosoft } from '@/lib/microsoft-proxy'

export async function GET(request: Request) {
  return forwardMicrosoft(request, '/microsoft/connection')
}

export async function DELETE(request: Request) {
  const response = await forwardMicrosoft(request, '/microsoft/connection', 'DELETE')
  const result = await response.json()
  const nextResponse = NextResponse.json(result, { status: response.status })
  if (response.ok) {
    nextResponse.cookies.set('microsoft_session_id', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
  }
  return nextResponse
}
