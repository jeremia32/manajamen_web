import { NextResponse } from 'next/server'
import { forwardAuthorization } from '@/lib/backend-auth'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params
	const backendUrl = process.env.LANGGRAPH_API_URL
	if (!backendUrl) {
		return NextResponse.json({ detail: 'Backend LangGraph belum dikonfigurasi.' }, { status: 503 })
	}

	const response = await fetch(`${backendUrl}/documents/${encodeURIComponent(id)}/text`, {
		headers: forwardAuthorization(request),
	})
	return NextResponse.json(await response.json(), { status: response.status })
}
