'use client'

import { useEffect, useState } from 'react'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

let browserClient: SupabaseClient | undefined

export function getSupabaseBrowserClient(): SupabaseClient {
	if (browserClient) return browserClient

	const url = process.env.NEXT_PUBLIC_SUPABASE_URL
	const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
	if (!url || !key) {
		throw new Error('NEXT_PUBLIC_SUPABASE_URL dan public/publishable key harus diatur.')
	}

	browserClient = createClient(url, key, {
		auth: {
			flowType: 'pkce',
			autoRefreshToken: true,
			persistSession: true,
			detectSessionInUrl: false,
		},
	})
	return browserClient
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
	const supabase = getSupabaseBrowserClient()
	const { data, error } = await supabase.auth.getSession()
	if (error) throw error
	if (!data.session) throw new Error('Silakan login untuk menggunakan fitur ini.')

	const headers = new Headers(init.headers)
	headers.set('Authorization', `Bearer ${data.session.access_token}`)
	return fetch(input, { ...init, headers })
}

export function useSupabaseAuth(): { user: User | null; loading: boolean; error: string | null } {
	const [user, setUser] = useState<User | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let client: SupabaseClient
		try {
			client = getSupabaseBrowserClient()
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Supabase Auth belum dikonfigurasi.')
			setLoading(false)
			return
		}

		const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
			setUser(session?.user ?? null)
			setLoading(false)
			setError(null)
		})

		void client.auth.getSession().then(({ data, error: sessionError }) => {
			if (sessionError) {
				setError(sessionError.message)
				setUser(null)
			} else {
				setUser(data.session?.user ?? null)
			}
			setLoading(false)
		}).catch((cause: unknown) => {
			setError(cause instanceof Error ? cause.message : 'Sesi login tidak dapat dimuat.')
			setUser(null)
			setLoading(false)
		})

		return () => subscription.unsubscribe()
	}, [])

	return { user, loading, error }
}
