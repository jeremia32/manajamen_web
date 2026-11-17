import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
	const path = request.nextUrl.pathname
	if (
		path === '/api/google-drive/auth/callback'
		|| path === '/api/microsoft/auth/callback'
		|| path === '/api/meetings/calendar/auth/callback'
	) {
		return NextResponse.next()
	}

	const authorization = request.headers.get('authorization')
	if (!authorization?.startsWith('Bearer ')) {
		return NextResponse.json({ error: 'Login diperlukan untuk mengakses fitur ini.' }, { status: 401 })
	}

	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
	const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
		|| process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
		|| process.env.SUPABASE_ANON_KEY
	if (!supabaseUrl || !publicKey) {
		return NextResponse.json({ error: 'Konfigurasi Supabase Auth belum lengkap.' }, { status: 503 })
	}

	let response: Response
	try {
		response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
			headers: { apikey: publicKey, Authorization: authorization },
			cache: 'no-store',
		})
	} catch {
		return NextResponse.json({ error: 'Supabase Auth tidak dapat dihubungi.' }, { status: 503 })
	}

	if (response.status === 401 || response.status === 403) {
		return NextResponse.json({ error: 'Sesi login tidak valid atau sudah kedaluwarsa. Silakan login kembali.' }, { status: 401 })
	}
	if (!response.ok) {
		return NextResponse.json({ error: 'Supabase Auth gagal memvalidasi sesi.' }, { status: 503 })
	}

	return NextResponse.next()
}

export const config = {
	matcher: [
		'/api/dashboard',
		'/api/assistant/:path*',
		'/api/search/:path*',
		'/api/documents/:path*',
		'/api/knowledge/:path*',
		'/api/profile',
		'/api/profile/:path*',
		'/api/profiles',
		'/api/profiles/:path*',
		'/api/meetings',
		'/api/meetings/:path*',
		'/api/notifications',
		'/api/notifications/:path*',
		'/api/google-drive/:path*',
		'/api/microsoft/:path*',
	],
}
