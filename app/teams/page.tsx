'use client'

import { useEffect, useState } from 'react'
import { Check, LoaderCircle, LogOut, MessageSquareText, RefreshCw, ShieldCheck, UsersRound } from 'lucide-react'
import { HutabyteShell, PageHeading } from '@/components/hutabyte-shell'
import { authenticatedFetch } from '@/lib/supabase-browser'

type Connection = { connected: boolean; display_name?: string; email?: string }
type MicrosoftTeam = { id: string; displayName: string; description?: string }
type MicrosoftChannel = { id: string; displayName: string; description?: string; membershipType?: string }

async function readError(response: Response) {
  const result = await response.json().catch(() => ({}))
  return result.detail || result.error || `Request gagal (HTTP ${response.status}).`
}

export default function TeamsPage() {
  const [connection, setConnection] = useState<Connection>({ connected: false })
  const [teams, setTeams] = useState<MicrosoftTeam[]>([])
  const [channels, setChannels] = useState<MicrosoftChannel[]>([])
  const [teamId, setTeamId] = useState('')
  const [channelId, setChannelId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [syncResult, setSyncResult] = useState('')

  async function loadTeams() {
    setLoadingTeams(true)
    setError('')
    try {
      const response = await authenticatedFetch('/api/microsoft/teams', { cache: 'no-store' })
      if (!response.ok) throw new Error(await readError(response))
      const items = await response.json() as MicrosoftTeam[]
      setTeams(items)
      setTeamId(current => items.some(item => item.id === current) ? current : items[0]?.id ?? '')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Daftar Team gagal dimuat.')
    } finally {
      setLoadingTeams(false)
    }
  }

  async function loadChannels(selectedTeamId: string) {
    if (!selectedTeamId) {
      setChannels([])
      setChannelId('')
      return
    }
    setLoadingChannels(true)
    setError('')
    try {
      const response = await authenticatedFetch(`/api/microsoft/teams/${encodeURIComponent(selectedTeamId)}/channels`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await readError(response))
      const items = await response.json() as MicrosoftChannel[]
      setChannels(items)
      setChannelId(current => items.some(item => item.id === current) ? current : items[0]?.id ?? '')
    } catch (cause) {
      setChannels([])
      setChannelId('')
      setError(cause instanceof Error ? cause.message : 'Daftar Channel gagal dimuat.')
    } finally {
      setLoadingChannels(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function initialize() {
      try {
        const response = await authenticatedFetch('/api/microsoft/connection', { cache: 'no-store' })
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || result.error || 'Status Microsoft gagal dimuat.')
        if (cancelled) return
        setConnection(result)
        const callbackError = new URLSearchParams(window.location.search).get('error')
        if (callbackError) setError(callbackError)
        if (result.connected) await loadTeams()
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Status Microsoft gagal dimuat.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void initialize()
    return () => { cancelled = true }
  }, [])

  useEffect(() => { if (teamId) void loadChannels(teamId) }, [teamId])

  async function connectMicrosoft() {
    setLoading(true)
    setError('')
    try {
      const response = await authenticatedFetch('/api/microsoft/auth/start', { method: 'POST' })
      const result = await response.json()
      if (!response.ok || !result.authorizationUrl) throw new Error(result.detail || result.error || 'Login Microsoft tidak dapat dimulai.')
      window.location.assign(result.authorizationUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Login Microsoft tidak dapat dimulai.')
      setLoading(false)
    }
  }

  async function disconnectMicrosoft() {
    setLoading(true)
    try {
      const response = await authenticatedFetch('/api/microsoft/connection', { method: 'DELETE' })
      if (!response.ok) throw new Error(await readError(response))
      setConnection({ connected: false })
      setTeams([])
      setChannels([])
      setTeamId('')
      setChannelId('')
      setSyncResult('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Akun Microsoft gagal diputus.')
    } finally {
      setLoading(false)
    }
  }

  async function syncMessages() {
    if (!teamId || !channelId || syncing) return
    setSyncing(true)
    setError('')
    setSyncResult('')
    try {
      const response = await authenticatedFetch('/api/microsoft/messages/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, channelId }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || result.error || 'Sinkronisasi pesan gagal.')
      setSyncResult(`${result.syncedCount} pesan Microsoft Teams tersimpan di Supabase.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sinkronisasi pesan gagal.')
    } finally {
      setSyncing(false)
    }
  }

  return <HutabyteShell><div className="mx-auto max-w-[1040px] px-5 py-8 sm:px-8 lg:px-12"><PageHeading title="Microsoft Teams" description="Hubungkan akun Microsoft, pilih Team dan Channel, lalu simpan pesan ke basis data workspace." />
    <section className="border-y border-border py-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-lg bg-[#e9f1ff] text-[#315da8]"><UsersRound className="size-5" /></span><div><h2 className="text-sm font-semibold">Akun Microsoft</h2><p className="mt-1 text-xs text-muted-foreground">{connection.connected ? `${connection.display_name || 'Terhubung'}${connection.email ? ` · ${connection.email}` : ''}` : 'Belum terhubung'}</p></div></div>{connection.connected ? <button type="button" onClick={disconnectMicrosoft} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium disabled:opacity-50"><LogOut className="size-3.5" />Putuskan akun</button> : <button type="button" onClick={connectMicrosoft} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-md bg-[#315da8] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{loading ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}Hubungkan Microsoft</button>}</div></section>
    {connection.connected && <section className="mt-7"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Pilih sumber pesan</h2><p className="mt-1 text-xs text-muted-foreground">Pilih Team dan Channel yang dapat diakses akun Anda.</p></div><button type="button" onClick={() => void loadTeams()} disabled={loadingTeams} aria-label="Muat ulang Team" className="rounded-md border p-2 text-muted-foreground hover:text-foreground disabled:opacity-50">{loadingTeams ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}</button></div><div className="grid gap-4 md:grid-cols-2"><label className="flex flex-col gap-2 text-xs font-medium">Team<select value={teamId} onChange={event => setTeamId(event.target.value)} disabled={loadingTeams || !teams.length} className="h-10 rounded-md border bg-background px-3 text-sm font-normal"><option value="">{loadingTeams ? 'Memuat Team...' : 'Pilih Team'}</option>{teams.map(team => <option key={team.id} value={team.id}>{team.displayName}</option>)}</select></label><label className="flex flex-col gap-2 text-xs font-medium">Channel<select value={channelId} onChange={event => setChannelId(event.target.value)} disabled={loadingChannels || !channels.length} className="h-10 rounded-md border bg-background px-3 text-sm font-normal"><option value="">{loadingChannels ? 'Memuat Channel...' : 'Pilih Channel'}</option>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.displayName}</option>)}</select></label></div><div className="mt-5 flex flex-wrap items-center gap-3"><button type="button" onClick={syncMessages} disabled={!teamId || !channelId || syncing} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{syncing ? <LoaderCircle className="size-4 animate-spin" /> : <MessageSquareText className="size-4" />}Sinkronkan pesan</button>{syncResult && <p role="status" className="flex items-center gap-2 text-xs text-emerald-700"><Check className="size-4" />{syncResult}</p>}</div></section>}
    {error && <div role="alert" className="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-800">{error}</div>}
    <p className="mt-8 text-xs leading-5 text-muted-foreground">Login menggunakan Microsoft OAuth. Pesan yang disinkronkan diberi label <code>microsoft_teams</code> di Supabase agar terpisah dari sumber/platform lain. Tahap ini hanya menyimpan pesan mentah; ringkasan dan MoM belum dijalankan.</p>
  </div></HutabyteShell>
}
