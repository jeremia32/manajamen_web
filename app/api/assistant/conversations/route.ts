import { NextResponse } from 'next/server'
import { forwardAuthorization } from '@/lib/backend-auth'

export async function GET(request: Request) {
  const backendUrl = process.env.LANGGRAPH_API_URL
  if (!backendUrl) return NextResponse.json({ error: 'Backend LangGraph belum dikonfigurasi.' }, { status: 503 })
  try {
    const response = await fetch(`${backendUrl}/assistant/conversations`, {
      headers: forwardAuthorization(request),
      cache: 'no-store',
    })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return NextResponse.json({ error: 'Backend riwayat percakapan tidak dapat dihubungi.' }, { status: 502 })
  }
}
