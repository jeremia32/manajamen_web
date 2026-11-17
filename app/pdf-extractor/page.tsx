'use client'

import { useRef, useState, type FormEvent } from 'react'
import { FileSearch, FileText, LoaderCircle, Send, Sparkles, Upload } from 'lucide-react'
import { HutabyteShell, PageHeading } from '@/components/hutabyte-shell'
import { authenticatedFetch } from '@/lib/supabase-browser'

type ExtractedDocument = {
	documentId: string
	name: string
	pageCount: number
	text: string
}

type ApiResult = {
	detail?: string
	error?: string
}

type SummaryResult = {
	summary: string
	partial: boolean
	chunksUsed: number
	providerUsed?: 'huggingface' | 'openai'
	fallbackUsed?: boolean
}

type AnswerSource = {
	documentName: string
	page: number
	snippet: string
}

type QuestionAnswer = {
	question: string
	answer: string
	sources: AnswerSource[]
	providerUsed?: 'huggingface' | 'openai'
	fallbackUsed?: boolean
	error?: boolean
}

async function readApiResult<T extends ApiResult>(response: Response, fallback: string): Promise<T> {
	const result = await response.json() as T
	if (!response.ok) {
		throw new Error(result.detail || result.error || fallback)
	}
	return result
}

export default function PdfExtractorPage() {
	const fileInput = useRef<HTMLInputElement>(null)
	const [selectedFile, setSelectedFile] = useState<File | null>(null)
	const [document, setDocument] = useState<ExtractedDocument | null>(null)
	const [summary, setSummary] = useState<SummaryResult | null>(null)
	const [questions, setQuestions] = useState<QuestionAnswer[]>([])
	const [question, setQuestion] = useState('')
	const [extracting, setExtracting] = useState(false)
	const [summarizing, setSummarizing] = useState(false)
	const [asking, setAsking] = useState(false)
	const [error, setError] = useState('')

	function chooseFile(file?: File) {
		setError('')
		setSummary(null)
		setQuestions([])
		if (!file) {
			setSelectedFile(null)
			return
		}
		if (!file.name.toLowerCase().endsWith('.pdf')) {
			setSelectedFile(null)
			setError('Pilih file PDF.')
			return
		}
		if (file.size > 50 * 1024 * 1024) {
			setSelectedFile(null)
			setError('Ukuran file maksimum 50 MB.')
			return
		}
		setSelectedFile(file)
	}

	async function extractPdf() {
		if (!selectedFile || extracting) return
		setExtracting(true)
		setError('')
		setDocument(null)
		setSummary(null)
		setQuestions([])
		try {
			const formData = new FormData()
			formData.set('file', selectedFile)
			const uploadResponse = await authenticatedFetch('/api/documents/extract-pdf', {
				method: 'POST',
				body: formData,
			})
			const uploaded = await readApiResult<{ documentId: string } & ApiResult>(
				uploadResponse,
				'PDF gagal diekstrak.',
			)
			const textResponse = await authenticatedFetch(`/api/documents/${encodeURIComponent(uploaded.documentId)}/text`)
			const extracted = await readApiResult<ExtractedDocument & ApiResult>(
				textResponse,
				'Teks hasil ekstraksi gagal dimuat.',
			)
			setDocument(extracted)
			setSelectedFile(null)
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'PDF gagal diekstrak.')
		} finally {
			setExtracting(false)
		}
	}

	async function createSummary() {
		if (!document || summarizing) return
		setSummarizing(true)
		setError('')
		try {
			const response = await authenticatedFetch(`/api/documents/${encodeURIComponent(document.documentId)}/summarize`, {
				method: 'POST',
			})
			const result = await readApiResult<SummaryResult & ApiResult>(
				response,
				'Ringkasan gagal dibuat.',
			)
			setSummary(result)
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Ringkasan gagal dibuat.')
		} finally {
			setSummarizing(false)
		}
	}

	async function askQuestion(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!document || !question.trim() || asking) return
		const submittedQuestion = question.trim()
		setAsking(true)
		setError('')
		try {
			const response = await authenticatedFetch(`/api/documents/${encodeURIComponent(document.documentId)}/ask`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					question: submittedQuestion,
					language: 'id',
					provider: 'huggingface',
				}),
			})
			const result = await readApiResult<{
				answer: string
				sources?: AnswerSource[]
				providerUsed?: 'huggingface' | 'openai'
				fallbackUsed?: boolean
			} & ApiResult>(
				response,
				'Pertanyaan gagal dijawab.',
			)
			setQuestions(current => [...current, {
				question: submittedQuestion,
				answer: result.answer,
				sources: result.sources ?? [],
				providerUsed: result.providerUsed,
				fallbackUsed: result.fallbackUsed,
			}])
			setQuestion('')
		} catch (cause) {
			setQuestions(current => [...current, {
				question: submittedQuestion,
				answer: cause instanceof Error ? cause.message : 'Pertanyaan gagal dijawab.',
				sources: [],
				error: true,
			}])
		} finally {
			setAsking(false)
		}
	}

	return (
		<HutabyteShell>
			<div className="mx-auto max-w-[1100px] px-5 py-10 sm:px-8 lg:px-12">
				<PageHeading
					eyebrow="Ekstraksi PDF digital"
					title="Ambil teks, ringkas, dan tanya PDF"
					description="Ekstraksi menggunakan pdfplumber untuk teks digital yang dapat dipilih. Tidak ada OCR untuk dokumen hasil scan."
				/>

				<section className="rounded-2xl border bg-card p-5 sm:p-7">
					<div className="flex items-start gap-3">
						<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><FileSearch className="size-5" /></span>
						<div>
							<h2 className="text-sm font-semibold">Unggah PDF digital</h2>
							<p className="mt-1 text-xs leading-5 text-muted-foreground">Teks PDF diekstrak di backend. PDF scan tanpa lapisan teks akan ditolak, bukan diproses dengan OCR.</p>
						</div>
					</div>
					<input
						ref={fileInput}
						type="file"
						accept=".pdf,application/pdf"
						className="sr-only"
						onChange={event => {
							chooseFile(event.target.files?.[0])
							event.currentTarget.value = ''
						}}
					/>
					<div className="mt-5 flex flex-col gap-3 rounded-xl border border-dashed p-5 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex min-w-0 items-center gap-3">
							<FileText className="size-5 shrink-0 text-primary" />
							<p className="truncate text-xs text-muted-foreground">{selectedFile?.name ?? 'Pilih PDF · maksimal 50 MB'}</p>
						</div>
						<div className="flex shrink-0 gap-2">
							<button type="button" onClick={() => fileInput.current?.click()} disabled={extracting} className="rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50">
								Pilih PDF
							</button>
							<button type="button" onClick={() => void extractPdf()} disabled={!selectedFile || extracting} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
								{extracting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
								{extracting ? 'Mengekstrak...' : 'Ekstrak teks'}
							</button>
						</div>
					</div>
					{error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}
				</section>

				{document && (
					<div className="mt-6 grid gap-5">
						<section className="overflow-hidden rounded-2xl border bg-card">
							<div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
								<div>
									<h2 className="text-sm font-semibold">{document.name}</h2>
									<p className="mt-1 text-xs text-muted-foreground">{document.pageCount} halaman dengan teks digital</p>
								</div>
								<button type="button" onClick={() => { setDocument(null); setSelectedFile(null); setSummary(null); setQuestions([]); setError('') }} className="rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted">
									PDF baru
								</button>
							</div>
							<pre className="max-h-[520px] overflow-auto whitespace-pre-wrap p-4 text-xs leading-6 text-muted-foreground">{document.text}</pre>
						</section>

						<section className="rounded-2xl border bg-card p-4 sm:p-5">
							<div className="flex flex-wrap items-center justify-between gap-3">
								<div className="flex items-center gap-2">
									<Sparkles className="size-4 text-primary" />
									<h2 className="text-sm font-semibold">Ringkasan dokumen</h2>
								</div>
								<button type="button" onClick={() => void createSummary()} disabled={summarizing} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
									{summarizing && <LoaderCircle className="size-3.5 animate-spin" />}
									{summary ? 'Buat ulang ringkasan' : 'Buat ringkasan'}
								</button>
							</div>
							{summary ? (
								<div className="mt-4">
									<p className="whitespace-pre-wrap text-sm leading-6">{summary.summary}</p>
									{summary.partial && <p className="mt-3 text-xs text-amber-700">Ringkasan memakai 80 bagian pertama karena dokumen sangat panjang.</p>}
									{summary.fallbackUsed && <p className="mt-3 text-xs text-amber-700">Hugging Face tidak tersedia; ringkasan dibuat menggunakan OpenAI.</p>}
								</div>
							) : <p className="mt-3 text-xs text-muted-foreground">Hugging Face dicoba terlebih dahulu; OpenAI digunakan otomatis jika Hugging Face tidak tersedia. Penggunaan OpenAI dapat dikenakan biaya API.</p>}
						</section>

						<section className="rounded-2xl border bg-card">
							<div className="border-b p-4">
								<h2 className="text-sm font-semibold">Tanya jawab dokumen</h2>
								<p className="mt-1 text-xs text-muted-foreground">Jawaban dibatasi pada teks hasil ekstraksi. Hugging Face dicoba terlebih dahulu, lalu OpenAI jika diperlukan; penggunaan OpenAI dapat dikenakan biaya API.</p>
							</div>
							<div className="flex max-h-[440px] flex-col gap-4 overflow-auto p-4">
								{questions.length === 0 && <p className="text-xs text-muted-foreground">Contoh: “Apa inti dokumen ini?” atau “Tanggal dan kewajiban apa yang disebutkan?”</p>}
								{questions.map((item, index) => (
									<div key={`${item.question}-${index}`} className="flex flex-col gap-2">
										<p className="self-end rounded-xl rounded-br-sm bg-primary px-3 py-2 text-xs text-primary-foreground">{item.question}</p>
										<div className={`self-start rounded-xl rounded-tl-sm border px-3 py-2 text-xs leading-5 ${item.error ? 'border-red-200 bg-red-50 text-red-800' : 'bg-muted/40'}`}>
											<p className="whitespace-pre-wrap">{item.answer}</p>
											{item.fallbackUsed && <p className="mt-2 border-t pt-2 text-[10px] text-amber-700">Hugging Face tidak tersedia; jawaban dibuat menggunakan OpenAI.</p>}
											{item.sources.length > 0 && <p className="mt-2 border-t pt-2 text-[10px] text-muted-foreground">Sumber: {item.sources.map(source => `halaman ${source.page}`).join(', ')}</p>}
										</div>
									</div>
								))}
								{asking && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Meminta jawaban dari AI...</p>}
							</div>
							<form onSubmit={askQuestion} className="flex gap-2 border-t p-3">
								<input value={question} onChange={event => setQuestion(event.target.value)} disabled={asking} placeholder="Tulis pertanyaan tentang PDF..." aria-label="Pertanyaan tentang PDF" className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
								<button type="submit" disabled={!question.trim() || asking} aria-label="Kirim pertanyaan" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50">
									{asking ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
								</button>
							</form>
						</section>
					</div>
				)}
			</div>
		</HutabyteShell>
	)
}
