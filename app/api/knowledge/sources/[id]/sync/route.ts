import { NextResponse } from 'next/server'
import { getSource } from '@/lib/sources-store'
import { forwardAuthorization } from '@/lib/backend-auth'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params
	const source = getSource(id)
	if (id === 'uploaded-files') {
		return NextResponse.json({ error: 'File sudah diindeks saat diunggah; tidak perlu disinkronkan.' }, { status: 409 })
	}
	if (source && !['outline', 'github', 'website', 'notion'].includes(source.type)) {
		return NextResponse.json({ syncId: `sync-${Date.now()}`, status: 'running', sourceId: id })
	}
	if (!process.env.LANGGRAPH_API_URL) return NextResponse.json({ error: 'Backend LangGraph belum dikonfigurasi.' }, { status: 503 })
	const response = await fetch(`${process.env.LANGGRAPH_API_URL}/knowledge/sources/${encodeURIComponent(id)}/sync`, {
		method: 'POST',
		headers: forwardAuthorization(request),
	})
	return NextResponse.json(await response.json(), { status: response.status })
}
