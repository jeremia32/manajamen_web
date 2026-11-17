import { NextResponse } from 'next/server'

export async function forwardMicrosoft(request: Request, path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: unknown) {
  const backendUrl = process.env.LANGGRAPH_API_URL
  if (!backendUrl) return NextResponse.json({ detail: 'Backend LangGraph belum dikonfigurasi.' }, { status: 503 })

  const cookie = request.headers.get('cookie') ?? ''
  const authorization = request.headers.get('authorization')
  try {
    const response = await fetch(`${backendUrl}${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(authorization ? { Authorization: authorization } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
    })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return NextResponse.json({ detail: 'Backend Microsoft Teams tidak dapat dihubungi.' }, { status: 502 })
  }
}
