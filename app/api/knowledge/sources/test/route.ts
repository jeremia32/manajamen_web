import { NextResponse } from 'next/server'
import { forwardAuthorization } from '@/lib/backend-auth'

export async function POST(request: Request) {
	const input = await request.json()
	if (!process.env.LANGGRAPH_API_URL) {
		return NextResponse.json({ success: false, message: 'Backend LangGraph belum dikonfigurasi.' }, { status: 503 })
	}
	const response = await fetch(`${process.env.LANGGRAPH_API_URL}/knowledge/sources/test`, {
		method: 'POST',
		headers: forwardAuthorization(request, { 'Content-Type': 'application/json' }),
		body: JSON.stringify(input),
	})
	return NextResponse.json(await response.json(), { status: response.status })
}
