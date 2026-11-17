'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck } from 'lucide-react'
import { authenticatedFetch } from '@/lib/supabase-browser'

type NotificationItem = {
  id: string
  meeting_id: string | null
  title: string
  message: string
  created_at: string
  is_read: boolean
}

type NotificationResponse = {
  unread_count: number
  notifications: NotificationItem[]
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function NotificationBell({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<NotificationResponse>({ unread_count: 0, notifications: [] })
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled) return
    let active = true
    const load = async () => {
      try {
        const response = await authenticatedFetch('/api/notifications', { cache: 'no-store' })
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || result.error || 'Notifikasi tidak dapat dimuat.')
        if (active) {
          setData(result as NotificationResponse)
          setError('')
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Notifikasi tidak dapat dimuat.')
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 30000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [enabled])

  async function markAllRead() {
    try {
      const response = await authenticatedFetch('/api/notifications/read-all', { method: 'POST' })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.detail || result.error || 'Notifikasi tidak dapat diperbarui.')
      }
      setData(current => ({
        ...current,
        unread_count: 0,
        notifications: current.notifications.map(item => ({ ...item, is_read: true })),
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Notifikasi tidak dapat diperbarui.')
    }
  }

  async function openNotification(item: NotificationItem) {
    if (!item.is_read) {
      try {
        const response = await authenticatedFetch(`/api/notifications/${item.id}/read`, { method: 'POST' })
        if (!response.ok) {
          const result = await response.json()
          throw new Error(result.detail || result.error || 'Notifikasi tidak dapat diperbarui.')
        }
        setData(current => ({
          ...current,
          unread_count: Math.max(0, current.unread_count - 1),
          notifications: current.notifications.map(notification =>
            notification.id === item.id ? { ...notification, is_read: true } : notification,
          ),
        }))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Notifikasi tidak dapat diperbarui.')
        return
      }
    }
    setOpen(false)
    if (item.meeting_id) router.push(`/meetings/${item.meeting_id}`)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted"
        aria-label={`Notifikasi${data.unread_count ? `, ${data.unread_count} belum dibaca` : ''}`}
        aria-expanded={open}
        aria-controls="meeting-notifications"
        disabled={!enabled}
      >
        <Bell className="size-4" />
        {data.unread_count > 0 && (
          <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-semibold text-white">
            {data.unread_count > 99 ? '99+' : data.unread_count}
          </span>
        )}
      </button>
      {open && (
        <section
          id="meeting-notifications"
          className="absolute right-0 top-[calc(100%+10px)] z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl"
          aria-label="Riwayat notifikasi"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Notifikasi</h2>
              <p className="text-[11px] text-muted-foreground">{data.unread_count} belum dibaca</p>
            </div>
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={!data.unread_count}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary disabled:opacity-40"
            >
              <CheckCheck className="size-3.5" /> Tandai dibaca
            </button>
          </div>
          {error && <p role="alert" className="border-b bg-red-50 px-4 py-2 text-xs text-red-700">{error}</p>}
          <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
            {data.notifications.length ? data.notifications.map(item => (
              <button
                type="button"
                key={item.id}
                onClick={() => void openNotification(item)}
                className={`block w-full border-b px-4 py-3 text-left transition hover:bg-muted ${item.is_read ? 'opacity-75' : ''}`}
              >
                <span className="flex items-start gap-2">
                  {!item.is_read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold">{item.title}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.message}</span>
                    <time className="mt-1.5 block text-[10px] text-muted-foreground">{formatTime(item.created_at)}</time>
                  </span>
                </span>
              </button>
            )) : (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">Belum ada notifikasi.</p>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
