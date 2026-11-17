import { NextResponse } from 'next/server'
import { forwardGoogleDrive } from '@/lib/google-drive-proxy'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ detail: 'Request import Google Drive tidak valid.' }, { status: 400 })
  }
  return forwardGoogleDrive(request, '/google-drive/import', 'POST', body)
}
