import { NextResponse } from 'next/server'
import { forwardAuthorization } from '@/lib/backend-auth'

export async function POST(request: Request) {
	const backendUrl = process.env.LANGGRAPH_API_URL
	if (!backendUrl) {
		return NextResponse.json({ detail: 'Backend LangGraph belum dikonfigurasi.' }, { status: 503 })
	}

	const formData = await request.formData()
	const response = await fetch(`${backendUrl}/documents/extract-pdf`, {
		method: 'POST',
		headers: forwardAuthorization(request),
		body: formData,
	})
	return NextResponse.json(await response.json(), { status: response.status })
}
