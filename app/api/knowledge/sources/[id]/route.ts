import { NextResponse } from 'next/server'
import { deleteSource, updateSource } from '@/lib/sources-store'
import { forwardAuthorization } from '@/lib/backend-auth'

const backendSourcePrefix = /^(outline-|github-|website-|notion-|uploaded-files$)/
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; const result = updateSource(id, await request.json()); return result ? NextResponse.json(result) : NextResponse.json({ error: 'Sumber tidak ditemukan' }, { status: 404 }) }
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params
	if (backendSourcePrefix.test(id) && process.env.LANGGRAPH_API_URL) {
		const response = await fetch(`${process.env.LANGGRAPH_API_URL}/knowledge/sources/${encodeURIComponent(id)}`, {
			method: 'DELETE',
			headers: forwardAuthorization(request),
		})
		return NextResponse.json(await response.json(), { status: response.status })
	}
	return NextResponse.json({ deleted: deleteSource(id) })
}
