'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { BookOpen, Bot, CalendarDays, FileSearch, FolderOpen, LayoutDashboard, LogIn, LogOut, Menu, Monitor, Moon, Plus, Sparkles, Sun, Upload, UserRound, UsersRound, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { GlobalSearch } from '@/components/global-search'
import { NotificationBell } from '@/components/notification-bell'
import { authenticatedFetch, getSupabaseBrowserClient, readApiResponse, useSupabaseAuth } from '@/lib/supabase-browser'

const navItems = [
  { href: '/', label: 'Dasbor', icon: LayoutDashboard }, { href: '/meetings', label: 'Meeting', icon: CalendarDays }, { href: '/assistant', label: 'Asisten AI', icon: Bot }, { href: '/analyzer', label: 'Analisis Dokumen', icon: FileSearch }, { href: '/pdf-extractor', label: 'Ekstraksi PDF', icon: FileSearch }, { href: '/knowledge', label: 'Basis Pengetahuan', icon: BookOpen }, { href: '/teams', label: 'Microsoft Teams', icon: UsersRound }, { href: '/knowledge', label: 'Dokumen Terbaru', icon: FolderOpen }, { href: '/profile', label: 'Profil', icon: UserRound },
]
const themes = [{ value: 'light', label: 'Terang', icon: Sun }, { value: 'dark', label: 'Gelap', icon: Moon }, { value: 'system', label: 'Sistem', icon: Monitor }]

type ProfilePreview = {
  full_name: string
  profile_photo_url: string | null
}

export function ThemeSwitcher() { const { theme, setTheme } = useTheme(); const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), []); const current = themes.findIndex((item) => item.value === theme); const cycle = () => setTheme(themes[(current + 1) % themes.length].value); if (!mounted) return <div className="h-8" />; return <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5">{themes.map(({ value, label, icon: Icon }) => <button key={value} onClick={() => setTheme(value)} aria-label={label} className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] transition-colors ${theme === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}><Icon className="size-3" /><span className="hidden xl:inline">{label}</span></button>)}</div> }

export function HutabyteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading: authLoading } = useSupabaseAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [authActionError, setAuthActionError] = useState('')
  const [profilePreview, setProfilePreview] = useState<ProfilePreview | null>(null)
  const protectedRoute = ['/assistant', '/analyzer', '/pdf-extractor', '/knowledge', '/teams', '/search', '/meetings', '/profile'].some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )

  useEffect(() => {
    if (!protectedRoute || authLoading || user) return
    const next = `${window.location.pathname}${window.location.search}`
    router.replace(`/login?next=${encodeURIComponent(next)}`)
  }, [authLoading, pathname, protectedRoute, router, user])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setProfilePreview(null)
      return
    }

    let active = true
    const loadProfilePreview = async () => {
      try {
        const response = await authenticatedFetch('/api/profile', { cache: 'no-store' })
        const profile = await readApiResponse<ProfilePreview>(response, 'Info profil navbar tidak dapat dimuat.')
        if (active) setProfilePreview(profile)
      } catch (cause) {
        if (active) console.error('Navbar profile could not be loaded:', cause)
      }
    }
    const refreshProfilePreview = () => { void loadProfilePreview() }
    void loadProfilePreview()
    window.addEventListener('profile-updated', refreshProfilePreview)
    return () => {
      active = false
      window.removeEventListener('profile-updated', refreshProfilePreview)
    }
  }, [authLoading, user?.id])

  useEffect(() => {
    if (!user || authLoading) return
    let lastActivity = Date.now()
    let inFlight = false
    const recordActivity = () => { lastActivity = Date.now() }
    const sendHeartbeat = async () => {
      if (inFlight || document.visibilityState !== 'visible' || Date.now() - lastActivity > 60000) return
      inFlight = true
      try {
        const response = await authenticatedFetch('/api/profile/presence', { method: 'POST' })
        if (!response.ok) {
          const result = await response.json()
          throw new Error(result.detail || result.error || 'Status online tidak dapat diperbarui.')
        }
      } catch (cause) {
        console.error('Presence heartbeat failed:', cause)
      } finally {
        inFlight = false
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') recordActivity()
    }
    const timer = window.setInterval(() => void sendHeartbeat(), 25000)
    window.addEventListener('pointerdown', recordActivity, { passive: true })
    window.addEventListener('pointermove', recordActivity, { passive: true })
    window.addEventListener('keydown', recordActivity)
    window.addEventListener('touchstart', recordActivity, { passive: true })
    document.addEventListener('visibilitychange', onVisibilityChange)
    void sendHeartbeat()
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pointerdown', recordActivity)
      window.removeEventListener('pointermove', recordActivity)
      window.removeEventListener('keydown', recordActivity)
      window.removeEventListener('touchstart', recordActivity)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [authLoading, user?.id])

  async function signOut() {
    setAuthActionError('')
    try {
      const { error } = await getSupabaseBrowserClient().auth.signOut()
      if (error) throw error
      router.replace('/')
    } catch (cause) {
      setAuthActionError(cause instanceof Error ? cause.message : 'Tidak dapat keluar dari akun.')
    }
  }

  const metadataName = user?.user_metadata?.full_name || user?.user_metadata?.name
  const metadataPhoto = user?.user_metadata?.avatar_url || user?.user_metadata?.picture
  const displayName = profilePreview?.full_name || (typeof metadataName === 'string' ? metadataName : '') || user?.email || 'Profil'
  const profilePhotoUrl = profilePreview?.profile_photo_url || (typeof metadataPhoto === 'string' ? metadataPhoto : '')
  const profileInitial = displayName.slice(0, 1).toUpperCase()

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-200">
      <header className="fixed inset-x-0 top-0 z-30 flex h-[58px] items-center border-b border-border bg-background/95 px-4 backdrop-blur lg:px-6">
        <button onClick={() => setMobileOpen(true)} className="mr-3 rounded-lg p-2 hover:bg-muted lg:hidden" aria-label="Buka navigasi">
          <Menu className="size-5" />
        </button>
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-[-0.03em]">
          <Image src="/logo-hutabyte.png" alt="Hutabyte" width={36} height={36} className="size-9 rounded-lg object-cover" />
          <span className="hidden text-[17px] sm:inline">Hutabyte</span>
        </Link>
        <div className="absolute left-1/2 -translate-x-1/2">{user && <GlobalSearch />}</div>
        <div className="relative ml-auto flex items-center gap-2">
          {authLoading ? <span className="size-8" aria-label="Memeriksa sesi" /> : user ? (
            <NotificationBell enabled />
          ) : (
            <NotificationBell enabled={false} />
          )}
          {authLoading ? null : user ? (
            <>
              <Link
                href="/profile"
                aria-label={`Buka profil ${displayName}`}
                title="Buka profil"
                className="group flex min-w-0 items-center gap-2 rounded-full border border-border/80 bg-card/80 py-1 pl-1 pr-3 shadow-sm transition hover:border-primary/40 hover:bg-muted/70 hover:shadow"
              >
                {profilePhotoUrl ? (
                  <img src={profilePhotoUrl} alt="" className="size-8 shrink-0 rounded-full object-cover ring-2 ring-background" />
                ) : (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary ring-2 ring-background">{profileInitial}</span>
                )}
                <span className="hidden min-w-0 text-left sm:block">
                  <span className="block max-w-32 truncate text-[11px] font-semibold leading-4">{displayName}</span>
                  <span className="block max-w-32 truncate text-[10px] leading-3 text-muted-foreground">{user.email}</span>
                </span>
              </Link>
              <button type="button" onClick={() => void signOut()} className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border/80 bg-card/80 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground" aria-label="Keluar" title="Keluar">
                <LogOut className="size-4" />
              </button>
            </>
          ) : (
            <Link href="/login" className="flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium hover:bg-muted"><LogIn className="size-3.5" />Masuk</Link>
          )}
          {authActionError && <p role="alert" className="absolute right-0 top-[calc(100%+10px)] z-50 w-64 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{authActionError}</p>}
        </div>
      </header>
      <aside className={`fixed bottom-0 left-0 top-[58px] z-40 w-[238px] border-r border-border bg-card px-3 py-4 transition-transform lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="mb-4 flex items-center justify-between lg:hidden">
          <span className="text-xs font-semibold">Ruang kerja</span>
          <button onClick={() => setMobileOpen(false)} aria-label="Tutup navigasi"><X className="size-4" /></button>
        </div>
        <Link href="/analyzer" onClick={() => setMobileOpen(false)} className="mb-5 flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90">
          <Plus className="size-3.5" /> Analisis Baru
        </Link>
        <p className="mb-2 px-2 text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Ruang kerja</p>
        <nav className="flex flex-col gap-0.5">
          {navItems.map(item => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link key={item.label} href={item.href} onClick={() => setMobileOpen(false)} className={`flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-xs transition ${active ? 'bg-accent font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                <Icon className="size-4" />{item.label}
              </Link>
            )
          })}
        </nav>
        <div className="my-6 border-t border-border" />
        <p className="mb-3 px-2 text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Analisis terbaru</p>
        <div className="flex flex-col gap-3 px-2">
          {[["Perjanjian Perusahaan", "2 jam lalu"], ["Kontrak Vendor", "Kemarin"], ["Kebijakan Kepatuhan", "3 hari lalu"]].map(([title, date]) => (
            <Link href="/analyzer/enterprise-agreement" key={title} className="group">
              <p className="truncate text-[11px] font-medium group-hover:text-primary">{title}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{date}</p>
            </Link>
          ))}
        </div>
        <div className="absolute bottom-4 left-3 right-3"><ThemeSwitcher /></div>
      </aside>
      {mobileOpen && <button className="fixed inset-0 z-30 bg-black/20 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Tutup overlay" />}
      <main className="min-h-screen pt-[58px] lg:pl-[238px]">
        {protectedRoute && (authLoading || !user) ? (
          <div className="flex min-h-[50vh] items-center justify-center px-6 text-sm text-muted-foreground">
            {authLoading ? 'Memeriksa sesi login...' : 'Mengalihkan ke halaman login...'}
          </div>
        ) : children}
      </main>
    </div>
  )
}
export const DocuMindShell = HutabyteShell
export function SectionLabel({ children }: { children: React.ReactNode }) { return <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"><Sparkles className="size-3" />{children}</div> }
export function ActionIcon({ children, tone = 'indigo' }: { children: React.ReactNode; tone?: 'indigo' | 'green' | 'amber' | 'blue' }) { return <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">{children}</span> }
export function PageHeading({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) { return <div className="mb-8"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><Sparkles className="size-3.5" />{eyebrow ?? 'Kecerdasan dokumen AI'}</div><h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-[36px]">{title}</h1>{description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}</div> }
export { Upload }
