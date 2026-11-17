export type SourceType = 'outline' | 'notion' | 'confluence' | 'github' | 'website' | 'rest' | 'pdf' | 'google-drive' | 'sharepoint' | 'dropbox'
export type SourceStatus = 'connected' | 'syncing' | 'error' | 'not_synced'
export type DocumentStatus = 'indexed' | 'processing' | 'failed'
export type SourceCredentials = Record<string, string>
export type KnowledgeSource = { id: string; name: string; type: SourceType; status: SourceStatus; documentCount: number; lastSync: string | null; maskedCredential?: string; credentials?: never }
export type IndexedDocument = { id: string; name: string; sourceId: string; sourceName: string; type: string; size: string; updatedAt: string; status: DocumentStatus }
export type SyncRun = { id: string; sourceId: string; sourceName: string; startedAt: string; duration: string; added: number; updated: number; failed: number; status: 'success' | 'running' | 'failed'; error?: string }
export type SourceCreateInput = { name: string; type: SourceType; credentials: SourceCredentials; syncFrequency: 'manual' | 'hourly' | 'daily' | 'weekly'; syncOnSave: boolean }
export type SourceTestResult = { success: boolean; message: string; documentCount?: number }
export type AssistantResponse = { answer: string; sources: { documentName: string; page: number; snippet: string; sourceId?: string; sourceName?: string; sourceType?: SourceType }[]; steps: string[]; proposedActions: { type: string; title: string; description: string }[] }
export type DocumentRecord = { id: string; name: string; type: string; size: string; status: 'Indexed' | 'Processing' | 'Failed'; createdAt: string }
export type AnalysisResponse = { extractedFields: Record<string, string>; summary: string; risks: { title: string; severity: 'High' | 'Medium' | 'Low'; detail: string }[] }
export type SourceStoreRecord = KnowledgeSource & { encryptedCredentials: string; syncFrequency: SourceCreateInput['syncFrequency']; syncOnSave: boolean }

export const SOURCE_LABELS: Record<SourceType, string> = { outline: 'Outline', notion: 'Notion', confluence: 'Confluence', github: 'GitHub', website: 'Situs Web / URL', rest: 'REST API Kustom', pdf: 'Unggah File (PDF)', 'google-drive': 'Google Drive', sharepoint: 'SharePoint', dropbox: 'Dropbox' }
export const SOURCE_ICONS: Record<SourceType, string> = { outline: 'O', notion: 'N', confluence: 'C', github: 'GH', website: 'W', rest: 'API', pdf: 'PDF', 'google-drive': 'G', sharepoint: 'S', dropbox: 'D' }
export const STATUS_LABELS: Record<SourceStatus, string> = { connected: 'Terhubung', syncing: 'Menyinkronkan', error: 'Error', not_synced: 'Belum Disinkronkan' }
export const DOC_STATUS_LABELS: Record<DocumentStatus, string> = { indexed: 'Terindeks', processing: 'Diproses', failed: 'Gagal' }
export const MOCK_SOURCES: KnowledgeSource[] = [{ id: 'outline-main', name: 'Wiki Perusahaan (Outline)', type: 'outline', status: 'connected', documentCount: 128, lastSync: 'Hari ini, 09:42' }, { id: 'notion-hr', name: 'Ruang HR & Kebijakan', type: 'notion', status: 'connected', documentCount: 64, lastSync: 'Kemarin, 16:20' }, { id: 'github-docs', name: 'Dokumentasi Produk', type: 'github', status: 'not_synced', documentCount: 0, lastSync: null }]
export const MOCK_DOCUMENTS: IndexedDocument[] = [{ id: 'doc-1', name: 'Kebijakan Cuti Karyawan.pdf', sourceId: 'outline-main', sourceName: 'Wiki Perusahaan (Outline)', type: 'PDF', size: '2,4 MB', updatedAt: 'Hari ini, 09:42', status: 'indexed' }, { id: 'doc-2', name: 'Panduan Onboarding.md', sourceId: 'github-docs', sourceName: 'Dokumentasi Produk', type: 'Markdown', size: '48 KB', updatedAt: 'Kemarin', status: 'processing' }, { id: 'doc-3', name: 'Perjanjian Vendor 2026.pdf', sourceId: 'notion-hr', sourceName: 'Ruang HR & Kebijakan', type: 'PDF', size: '3,1 MB', updatedAt: '25 Sep 2026', status: 'indexed' }]
export const MOCK_SYNC_RUNS: SyncRun[] = [{ id: 'sync-1', sourceId: 'outline-main', sourceName: 'Wiki Perusahaan (Outline)', startedAt: 'Hari ini, 09:40', duration: '1m 24d', added: 8, updated: 21, failed: 0, status: 'success' }, { id: 'sync-2', sourceId: 'notion-hr', sourceName: 'Ruang HR & Kebijakan', startedAt: 'Kemarin, 16:19', duration: '42d', added: 3, updated: 12, failed: 1, status: 'failed', error: 'Satu halaman tidak dapat diakses oleh integration token.' }]

export function sourceLabel(type: SourceType) { return SOURCE_LABELS[type] }
export function sourceIcon(type: SourceType) { return SOURCE_ICONS[type] }
export function statusLabel(status: SourceStatus) { return STATUS_LABELS[status] }
export function documentStatusLabel(status: DocumentStatus) { return DOC_STATUS_LABELS[status] } 
