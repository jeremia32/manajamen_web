'use client'

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { ArrowUp, Bot, FileText, LoaderCircle, Plus, Search, Sparkles, UserRound } from 'lucide-react'
import { ActionIcon, HutabyteShell } from '@/components/hutabyte-shell'
import type { AssistantResponse, KnowledgeSource } from '@/lib/types'
import { authenticatedFetch } from '@/lib/supabase-browser'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: AssistantResponse['sources']
  error?: boolean
}

type ChatConversation = { id: string; title: string; createdAt: string; updatedAt: string }

const suggestions = ['Apa kebijakan cuti perusahaan?', 'Ringkas kontrak vendor terbaru']

export default function AssistantPage() {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [historySearch, setHistorySearch] = useState('')
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [sending, setSending] = useState(false)
  const conversationEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    authenticatedFetch('/api/knowledge/sources')
      .then(response => response.json())
      .then((items: KnowledgeSource[]) => {
        setSources(items)
        setSelected(items.map(item => item.id))
      })
      .catch(() => setSources([]))
  }, [])

  async function refreshConversations() {
    const response = await authenticatedFetch('/api/assistant/conversations', { cache: 'no-store' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.detail || result.error || 'Riwayat percakapan gagal dimuat.')
    setHistoryError('')
    setConversations(result as ChatConversation[])
    return result as ChatConversation[]
  }

  async function openConversation(id: string) {
    if (sending || id === conversationId) return
    setLoadingHistory(true)
    try {
      const response = await authenticatedFetch(`/api/assistant/conversations/${id}`, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || result.error || 'Percakapan gagal dimuat.')
      setConversationId(result.id)
      setMessages(result.messages as ChatMessage[])
      setMessage('')
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Percakapan gagal dimuat.')
      setMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant', content: error instanceof Error ? error.message : 'Percakapan gagal dimuat.', error: true }])
    } finally {
      setLoadingHistory(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    authenticatedFetch('/api/assistant/conversations', { cache: 'no-store' })
      .then(async response => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || result.error || 'Riwayat percakapan gagal dimuat.')
        if (cancelled) return
        const items = result as ChatConversation[]
        setConversations(items)
        if (items[0]) await openConversation(items[0].id)
      })
      .catch(cause => { if (!cancelled) { setConversations([]); setHistoryError(cause instanceof Error ? cause.message : 'Riwayat percakapan gagal dimuat.') } })
      .finally(() => { if (!cancelled) setLoadingHistory(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    conversationEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending])

  async function sendQuestion(question = message) {
    const content = question.trim()
    if (!content || sending) return

    setMessages(current => [...current, { id: crypto.randomUUID(), role: 'user', content }])
    setMessage('')
    setSending(true)

    try {
      const response = await authenticatedFetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, sourceIds: selected, language: 'id', conversationId }),
      })
      const result = await response.json() as AssistantResponse & { detail?: string; error?: string; conversationId?: string }
      if (!response.ok) throw new Error(result.detail || result.error || 'Asisten tidak dapat memproses pertanyaan.')
      if (result.conversationId) setConversationId(result.conversationId)

      setMessages(current => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.answer || 'Asisten belum mengembalikan jawaban.',
        sources: result.sources ?? [],
      }])
      const refreshed = await refreshConversations()
      if (result.conversationId) setConversations(refreshed)
    } catch (error) {
      setMessages(current => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: error instanceof Error ? error.message : 'Tidak dapat terhubung ke backend AI. Pastikan backend LangGraph sedang berjalan.',
        error: true,
      }])
    } finally {
      setSending(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void sendQuestion()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendQuestion()
    }
  }

  function startNewConversation() {
    if (sending) return
    setConversationId(null)
    setMessages([])
    setMessage('')
  }

  const visibleConversations = conversations.filter(item => item.title.toLowerCase().includes(historySearch.toLowerCase()))

  return (
    <HutabyteShell>
      <div className="mx-auto flex h-[calc(100vh-58px)] max-w-[1320px] flex-col lg:flex-row">
        <aside className="hidden w-[270px] shrink-0 border-r border-[#e8e8eb] bg-white p-5 lg:block">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Percakapan</h2>
            <button onClick={startNewConversation} aria-label="Percakapan baru" className="rounded-md p-1.5 hover:bg-[#f2f2f5]">
              <Plus className="size-4" />
            </button>
          </div>
          <div className="mb-5 flex items-center gap-2 rounded-lg bg-[#f7f7f8] px-3 py-2 text-xs text-[#96969e]">
            <Search className="size-3.5 shrink-0" /><input value={historySearch} onChange={event => setHistorySearch(event.target.value)} placeholder="Cari percakapan" aria-label="Cari percakapan" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#96969e]" />
          </div>
          <div className="flex max-h-[38vh] flex-col gap-1 overflow-y-auto">
            {loadingHistory && <p className="px-3 py-2 text-xs text-muted-foreground">Memuat riwayat...</p>}
            {!loadingHistory && historyError && <p role="alert" className="px-3 py-2 text-xs leading-5 text-red-700">{historyError}</p>}
            {!loadingHistory && visibleConversations.map(item => <button key={item.id} type="button" onClick={() => void openConversation(item.id)} className={`rounded-lg px-3 py-2.5 text-left text-xs transition ${item.id === conversationId ? 'bg-[#f0f0f3] font-medium text-foreground' : 'text-[#777780] hover:bg-[#f7f7f8]'}`}><span className="block truncate">{item.title}</span><span className="mt-1 block text-[10px] text-[#a4a4ab]">{new Date(item.updatedAt).toLocaleString('id-ID')}</span></button>)}
            {!loadingHistory && conversations.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">Belum ada percakapan tersimpan.</p>}
            {!loadingHistory && conversations.length > 0 && visibleConversations.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">Percakapan tidak ditemukan.</p>}
          </div>
          <div className="mt-8 border-t border-[#eeeeef] pt-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[.12em] text-[#aaaab2]">Sumber pengetahuan</p>
              <span className="text-[10px] text-muted-foreground">{selected.length} dipilih</span>
            </div>
            {sources.map(source => (
              <label key={source.id} className="mb-3 flex cursor-pointer items-center gap-2 text-xs text-[#777780]">
                <input
                  type="checkbox"
                  checked={selected.includes(source.id)}
                  onChange={() => setSelected(current => current.includes(source.id) ? current.filter(id => id !== source.id) : [...current, source.id])}
                  className="accent-[#5963dc]"
                />
                <FileText className="size-3.5 shrink-0 text-[#5963dc]" />
                <span className="truncate">{source.name}</span>
              </label>
            ))}
            {sources.length === 0 && <p className="text-xs text-muted-foreground">Belum ada sumber yang tersedia.</p>}
            <Link href="/knowledge" className="mt-2 flex items-center gap-2 text-xs font-semibold text-[#5963dc]">
              <Plus className="size-3.5" />Tambah sumber
            </Link>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-[#e8e8eb] bg-white px-5 py-4 sm:px-8">
            <div className="flex items-center gap-3">
              <ActionIcon><Bot className="size-4" /></ActionIcon>
              <div>
                <h1 className="text-sm font-semibold">Asisten AI</h1>
                <p className="text-[11px] text-[#92929a]">Jawaban dibuat dari dokumen di sumber yang dipilih.</p>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-8 sm:px-12">
            {messages.length === 0 ? (
              <div className="m-auto max-w-lg text-center">
                <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-[#eef0ff] text-[#5963dc]">
                  <Sparkles className="size-7" />
                </div>
                <h2 className="text-xl font-semibold">Apa yang ingin Anda ketahui?</h2>
                <p className="mt-2 text-sm leading-6 text-[#85858e]">Tanyakan tentang dokumen Anda. Asisten akan mencari konteks yang relevan sebelum menjawab.</p>
                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  {suggestions.map(suggestion => (
                    <button key={suggestion} type="button" onClick={() => void sendQuestion(suggestion)} disabled={sending} className="rounded-lg border bg-white px-3 py-3 text-left text-xs text-[#777780] hover:border-[#bfc2ff] disabled:opacity-50">
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
                {messages.map(item => item.role === 'user' ? (
                  <div key={item.id} className="flex justify-end gap-2">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[#5963dc] px-4 py-3 text-sm leading-6 text-white">{item.content}</div>
                    <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f0f0f3] text-[#777780]"><UserRound className="size-4" /></span>
                  </div>
                ) : (
                  <div key={item.id} className="flex items-start gap-3">
                    <ActionIcon><Bot className="size-4" /></ActionIcon>
                    <div className={`min-w-0 max-w-[90%] rounded-2xl rounded-tl-sm border px-4 py-3 text-sm leading-6 ${item.error ? 'border-red-200 bg-red-50 text-red-800' : 'bg-white text-[#55555f]'}`}>
                      <p className="whitespace-pre-wrap">{item.content}</p>
                      {!!item.sources?.length && (
                        <div className="mt-4 border-t pt-3">
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#777780]">Sumber</p>
                          <div className="flex flex-col gap-2">
                            {item.sources.map((source, index) => (
                              <div key={`${source.documentName}-${index}`} className="rounded-lg bg-[#f7f7f8] p-3 text-xs">
                                <p className="font-semibold">{source.documentName}{source.page ? ` · halaman ${source.page}` : ''}</p>
                                <p className="mt-1 line-clamp-3 text-[#777780]">{source.snippet}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status" aria-live="polite">
                    <ActionIcon><Bot className="size-4" /></ActionIcon>
                    <span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" />Sedang mencari dokumen dan menyusun jawaban...</span>
                  </div>
                )}
                <div ref={conversationEnd} />
              </div>
            )}

            <form onSubmit={handleSubmit} className="mx-auto mt-auto w-full max-w-3xl pt-8">
              <div className="flex items-end gap-2 rounded-2xl border bg-white p-2 shadow-sm">
                <textarea
                  value={message}
                  onChange={event => setMessage(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Tanyakan sesuatu tentang dokumen Anda..."
                  aria-label="Pesan untuk Asisten AI"
                  rows={2}
                  className="max-h-40 min-h-12 flex-1 resize-y bg-transparent px-3 py-3 text-sm outline-none"
                />
                <button type="submit" disabled={!message.trim() || sending} aria-label="Kirim pertanyaan" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#5963dc] text-white disabled:cursor-not-allowed disabled:opacity-50">
                  {sending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                </button>
              </div>
              <p className="mt-2 text-center text-[10px] text-[#aaaab2]">Enter untuk mengirim, Shift+Enter untuk baris baru. Periksa sumber sebelum mengambil tindakan.</p>
            </form>
          </div>
        </section>
      </div>
    </HutabyteShell>
  )
}
