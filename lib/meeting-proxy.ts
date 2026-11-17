import { NextResponse } from 'next/server'
import { forwardAuthorization } from '@/lib/backend-auth'

export async function forwardMeetingRequest(request: Request, backendPath: string): Promise<Response> {
  const backendUrl = process.env.LANGGRAPH_API_URL
  if (!backendUrl) {
    return NextResponse.json({ error: 'Backend meeting belum dikonfigurasi.' }, { status: 503 })
  }

  const url = new URL(`${backendUrl.replace(/\/+$/, '')}/${backendPath.replace(/^\/+/, '')}`)
  url.search = new URL(request.url).search
  const headers = forwardAuthorization(request)
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('Content-Type', contentType)
  let body: ArrayBuffer | undefined
  if (!['GET', 'HEAD'].includes(request.method)) {
    const requestBody = await request.arrayBuffer()
    if (requestBody.byteLength) body = requestBody
  }

  try {
    const response = await fetch(url, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
    })
    const contentType = response.headers.get('Content-Type') || ''
    if (!contentType.toLowerCase().includes('json')) {
      const message = (await response.text()).trim().slice(0, 500)
      return NextResponse.json(
        { error: message || `Backend mengembalikan respons tidak valid (HTTP ${response.status}).` },
        { status: response.ok ? 502 : response.status },
      )
    }
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Backend meeting tidak dapat dihubungi.' }, { status: 502 })
  }
}
