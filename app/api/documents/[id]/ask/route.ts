import { NextResponse } from 'next/server'
import { forwardAuthorization } from '@/lib/backend-auth'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()

  if (process.env.LANGGRAPH_API_URL) {
    const response = await fetch(`${process.env.LANGGRAPH_API_URL}/documents/${id}/ask`, {
      method: 'POST',
      headers: forwardAuthorization(request, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
    return NextResponse.json(await response.json(), { status: response.status })
  }

  return NextResponse.json({ error: 'Backend LangGraph belum dikonfigurasi.' }, { status: 503 })
}