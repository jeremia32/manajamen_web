'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase-browser'

function getNextPath(value: string | null): string {
	return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export default function AuthCallbackPage() {
	const started = useRef(false)
	const [error, setError] = useState('')

	useEffect(() => {
		if (started.current) return
		started.current = true

		const params = new URLSearchParams(window.location.search)
		const code = params.get('code')
		const next = getNextPath(params.get('next'))
		const providerError = params.get('error_description') || params.get('error')

		if (providerError) {
			setError(providerError)
			return
		}
		if (!code) {
			setError('Callback autentikasi tidak berisi kode. Silakan coba login kembali.')
			return
		}

		try {
			void getSupabaseBrowserClient().auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
				if (exchangeError) {
					setError(exchangeError.message)
					return
				}
				window.location.replace(next)
			}).catch((cause: unknown) => {
				setError(cause instanceof Error ? cause.message : 'Tidak dapat menyelesaikan autentikasi.')
			})
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Tidak dapat menyelesaikan autentikasi.')
		}
	}, [])

	return (
		<main className="flex min-h-screen items-center justify-center bg-background px-5 text-foreground">
			<div className="w-full max-w-md rounded-2xl border bg-card p-7 text-center shadow-sm">
				<h1 className="text-xl font-semibold">{error ? 'Login tidak berhasil' : 'Menyelesaikan login...'}</h1>
				{error
					? <><p role="alert" className="mt-3 text-sm text-destructive">{error}</p><Link href="/login" className="mt-5 inline-block text-sm font-semibold text-primary hover:underline">Kembali ke login</Link></>
					: <p role="status" className="mt-3 text-sm text-muted-foreground">Mohon tunggu, sesi Anda sedang diverifikasi.</p>}
			</div>
		</main>
	)
}
