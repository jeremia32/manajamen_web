import { NextResponse } from 'next/server'
import { forwardAuthorization } from '@/lib/backend-auth'

type RouteContext = { params: Promise<{ id: string }> }

async function forward(request: Request, id: string, method: 'GET' | 'DELETE') {
  const backendUrl = process.env.LANGGRAPH_API_URL
  if (!backendUrl) return NextResponse.json({ error: 'Backend LangGraph belum dikonfigurasi.' }, { status: 503 })
  try {
    const response = await fetch(`${backendUrl}/assistant/conversations/${encodeURIComponent(id)}`, {
      method,
      headers: forwardAuthorization(request),
      cache: 'no-store',
    })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return NextResponse.json({ error: 'Backend riwayat percakapan tidak dapat dihubungi.' }, { status: 502 })
  }
}

export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params
  return forward(request, id, 'GET')
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { id } = await params
  return forward(request, id, 'DELETE')
}
