import { NextResponse } from 'next/server'
import { createSource, listSources, testSource } from '@/lib/sources-store'
import type { SourceCreateInput } from '@/lib/types'
import { forwardAuthorization } from '@/lib/backend-auth'

const backendConnectorTypes = new Set(['outline', 'github', 'website', 'notion', 'pdf'])

async function backendRequest(request: Request, path: string, init?: RequestInit) {
	const baseUrl = process.env.LANGGRAPH_API_URL
	if (!baseUrl) return null
	return fetch(`${baseUrl}${path}`, {
		...init,
		headers: forwardAuthorization(request, init?.headers),
	})
}

export async function GET(request: Request) {
	const response = await backendRequest(request, '/knowledge/sources')
	if (!response) return NextResponse.json({ error: 'Backend LangGraph belum dikonfigurasi.' }, { status: 503 })
	const body = await response.json()
	if (!response.ok) return NextResponse.json(body, { status: response.status })
	const localSources = listSources().filter(source => !backendConnectorTypes.has(source.type))
	const backendSources = Array.isArray(body) ? body : []
	return NextResponse.json([...localSources, ...backendSources])
}

export async function POST(request: Request) {
	const input = await request.json() as SourceCreateInput
	if (backendConnectorTypes.has(input.type)) {
		const response = await backendRequest(request, '/knowledge/sources', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: input.name, type: input.type, credentials: input.credentials }),
		})
		if (!response) return NextResponse.json({ error: 'Backend LangGraph belum dikonfigurasi.' }, { status: 503 })
		return NextResponse.json(await response.json(), { status: response.status })
	}
	return NextResponse.json(createSource(input), { status: 201 })
}

export async function PUT(request: Request) {
	const input = await request.json() as SourceCreateInput
	if (backendConnectorTypes.has(input.type)) {
		const response = await backendRequest(request, '/knowledge/sources/test', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: input.name, type: input.type, credentials: input.credentials }),
		})
		if (!response) return NextResponse.json({ success: false, message: 'Backend LangGraph belum dikonfigurasi.' }, { status: 503 })
		return NextResponse.json(await response.json(), { status: response.status })
	}
	return NextResponse.json(testSource(input))
}
