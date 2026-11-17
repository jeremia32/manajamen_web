import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { forwardAuthorization } from '@/lib/backend-auth'

function getSupabaseAdmin() {
	const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
	const serviceRoleKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
	if (!url || !serviceRoleKey) return null
	return createClient(url, serviceRoleKey, { auth: { persistSession: false } })
}

export async function GET(request: Request) {
	if (process.env.LANGGRAPH_API_URL) {
		const response = await fetch(`${process.env.LANGGRAPH_API_URL}/documents`, {
			headers: forwardAuthorization(request),
		})
		return NextResponse.json(await response.json(), { status: response.status })
	}

	const supabase = getSupabaseAdmin()
	if (!supabase) {
		return NextResponse.json({ documents: [{ id: 'vendor-contract', name: 'Vendor Contract.pdf', type: 'Contract', size: '2.4 MB', status: 'Indexed', createdAt: 'Today, 9:42 AM' }] })
	}

	const { data, error } = await supabase
		.from('documents')
		.select('id, name, mime_type, size_bytes, status, created_at')
		.order('created_at', { ascending: false })
	if (error) return NextResponse.json({ error: error.message }, { status: 500 })

	const documents = (data ?? []).map((document) => ({
		id: document.id,
		name: document.name,
		type: document.mime_type,
		size: `${(document.size_bytes / (1024 * 1024)).toFixed(1)} MB`,
		status: document.status === 'indexed' ? 'Indexed' : document.status === 'failed' ? 'Failed' : 'Processing',
		createdAt: document.created_at,
	}))
	return NextResponse.json({ documents })
}

export async function POST(request: Request) {
	const formData = await request.formData()
	const file = formData.get('file')
	if (!(file instanceof File)) {
		return NextResponse.json({ error: 'Pilih file yang akan diunggah.' }, { status: 400 })
	}
	if (!/\.(pdf|docx|txt|md)$/i.test(file.name)) {
		return NextResponse.json({ error: 'Format file yang didukung: PDF, DOCX, TXT, dan MD.' }, { status: 415 })
	}

	if (process.env.LANGGRAPH_API_URL) {
		const response = await fetch(`${process.env.LANGGRAPH_API_URL}/documents/upload`, {
			method: 'POST',
			headers: forwardAuthorization(request),
			body: formData,
		})
		return NextResponse.json(await response.json(), { status: response.status })
	}

	const supabase = getSupabaseAdmin()
	if (!supabase) return NextResponse.json({ documentId: 'vendor-contract', mode: 'mock' })

	const documentId = crypto.randomUUID()
	const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
	const storagePath = `${documentId}/${safeName}`
	const { error: uploadError } = await supabase.storage
		.from(process.env.SUPABASE_STORAGE_BUCKET ?? 'documents')
		.upload(storagePath, file, { contentType: file.type || 'application/octet-stream', upsert: false })
	if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 502 })

	const { error: insertError } = await supabase.from('documents').insert({
		id: documentId,
		name: file.name,
		mime_type: file.type || 'application/octet-stream',
		size_bytes: file.size,
		storage_path: storagePath,
		status: 'processing',
	})
	if (insertError) {
		await supabase.storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? 'documents').remove([storagePath])
		return NextResponse.json({ error: insertError.message }, { status: 500 })
	}

	return NextResponse.json({ documentId, status: 'processing' }, { status: 201 })
}
