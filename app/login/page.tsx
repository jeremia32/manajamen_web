'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase-browser'

function getNextPath(): string {
	const next = new URLSearchParams(window.location.search).get('next')
	return next?.startsWith('/') && !next.startsWith('//') ? next : '/'
}

export default function LoginPage() {
	const [mode, setMode] = useState<'login' | 'signup'>('login')
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [message, setMessage] = useState('')

	async function submitEmail(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (busy) return
		setBusy(true)
		setError('')
		setMessage('')
		try {
			const supabase = getSupabaseBrowserClient()
			if (mode === 'login') {
				const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
				if (authError) throw authError
				window.location.assign(getNextPath())
				return
			}

			const callback = new URL('/auth/callback', window.location.origin)
			callback.searchParams.set('next', getNextPath())
			const { data, error: authError } = await supabase.auth.signUp({
				email,
				password,
				options: { emailRedirectTo: callback.toString() },
			})
			if (authError) throw authError
			if (data.session) {
				window.location.assign(getNextPath())
				return
			}
			setMessage('Akun berhasil dibuat. Periksa email untuk mengonfirmasi akun sebelum login.')
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Autentikasi gagal.')
		} finally {
			setBusy(false)
		}
	}

	async function signInWithGoogle() {
		if (busy) return
		setBusy(true)
		setError('')
		setMessage('')
		try {
			const callback = new URL('/auth/callback', window.location.origin)
			callback.searchParams.set('next', getNextPath())
			const { error: authError } = await getSupabaseBrowserClient().auth.signInWithOAuth({
				provider: 'google',
				options: { redirectTo: callback.toString() },
			})
			if (authError) throw authError
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Login Google gagal.')
			setBusy(false)
		}
	}

	return (
		<main className="flex min-h-screen flex-col bg-background text-foreground">
			<header className="flex h-[58px] items-center justify-between border-b px-5 sm:px-8">
				<Link href="/" className="font-semibold tracking-tight">Hutabyte</Link>
				<span className="text-xs text-muted-foreground">Autentikasi workspace</span>
			</header>
			<div className="flex flex-1 items-center justify-center px-5 py-10">
				<section className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
					<h1 className="text-2xl font-semibold">{mode === 'login' ? 'Masuk ke Hutabyte' : 'Buat akun Hutabyte'}</h1>
					<p className="mt-2 text-sm leading-6 text-muted-foreground">
						Login diperlukan untuk mengakses asisten AI, analisis, dan dokumen workspace.
					</p>

					<button
						type="button"
						onClick={() => void signInWithGoogle()}
						disabled={busy}
						className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
					>
						<span aria-hidden="true" className="font-bold text-base">G</span>
						Lanjutkan dengan Google
					</button>

					<div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
						<span className="h-px flex-1 bg-border" />
						atau gunakan email
						<span className="h-px flex-1 bg-border" />
					</div>

					<form onSubmit={submitEmail} className="flex flex-col gap-4">
						<label className="flex flex-col gap-1.5 text-sm font-medium">
							Email
							<input
								type="email"
								autoComplete="email"
								required
								value={email}
								onChange={event => setEmail(event.target.value)}
								className="rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
							/>
						</label>
						<label className="flex flex-col gap-1.5 text-sm font-medium">
							Kata sandi
							<input
								type="password"
								autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
								minLength={6}
								required
								value={password}
								onChange={event => setPassword(event.target.value)}
								className="rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
							/>
						</label>
						<button
							type="submit"
							disabled={busy}
							className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
						>
							{busy ? 'Memproses...' : mode === 'login' ? 'Masuk dengan email' : 'Daftar dengan email'}
						</button>
					</form>

					{error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}
					{message && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{message}</p>}

					<p className="mt-5 text-center text-xs text-muted-foreground">
						{mode === 'login' ? 'Belum punya akun?' : 'Sudah punya akun?'}{' '}
						<button
							type="button"
							onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage('') }}
							className="font-semibold text-primary hover:underline"
						>
							{mode === 'login' ? 'Daftar' : 'Masuk'}
						</button>
					</p>
				</section>
			</div>
		</main>
	)
}
