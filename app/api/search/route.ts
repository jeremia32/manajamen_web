import { NextResponse } from 'next/server'
import { getDocuments } from '@/lib/sources-store'
import { forwardAuthorization } from '@/lib/backend-auth'

const analyses = [
  { id: 'enterprise-agreement', title: 'Perjanjian Perusahaan', source: 'Analisis Dokumen', snippet: 'Ringkasan risiko dan klausul penting dari perjanjian perusahaan.' },
  { id: 'vendor-contract', title: 'Kontrak Vendor', source: 'Analisis Dokumen', snippet: 'Perpanjangan otomatis dan kewajiban pemberitahuan 60 hari.' },
]
const conversations = [
  { id: 'refund-policy', title: 'Ringkasan kebijakan pengembalian dana', source: 'Asisten AI', snippet: 'Pelanggan dapat mengajukan pengembalian dana dalam 30 hari.' },
  { id: 'onboarding', title: 'Panduan onboarding tim baru', source: 'Asisten AI', snippet: 'Langkah awal untuk anggota tim baru dan akses pengetahuan.' },
]

function matches(value: string, q: string) { return value.toLocaleLowerCase('id-ID').includes(q.toLocaleLowerCase('id-ID')) }
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  if (!q) return NextResponse.json({ results: [], query: q })
  if (process.env.LANGGRAPH_API_URL) {
    try {
      const response = await fetch(`${process.env.LANGGRAPH_API_URL}/search?q=${encodeURIComponent(q)}`, { headers: forwardAuthorization(request), method: 'GET' })
      if (response.ok) return NextResponse.json(await response.json())
    } catch { /* fall back to local indexed data */ }
  }
  const documents = getDocuments().filter((item) => matches(`${item.name} ${item.sourceName} ${item.type}`, q)).map((item) => ({ type: 'document', id: item.id, title: item.name, source: item.sourceName, snippet: `Dokumen ${item.type} dari ${item.sourceName}, diperbarui ${item.updatedAt}.`, href: '/knowledge' }))
  const resultAnalyses = analyses.filter((item) => matches(`${item.title} ${item.source} ${item.snippet}`, q)).map((item) => ({ ...item, type: 'analysis', href: `/analyzer/${item.id}` }))
  const chats = conversations.filter((item) => matches(`${item.title} ${item.source} ${item.snippet}`, q)).map((item) => ({ ...item, type: 'conversation', href: `/assistant?conversation=${item.id}` }))
  return NextResponse.json({ query: q, results: [...documents, ...resultAnalyses, ...chats] })
}
