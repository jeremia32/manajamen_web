import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'

export const metadata: Metadata = { title: 'Hutabyte – Asisten AI & Analisis Dokumen', description: 'Ubah pengetahuan perusahaan menjadi jawaban jelas, keputusan lebih cepat, dan tindakan yang percaya diri.', icons: { icon: '/logo-hutabyte.png' } }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="id" suppressHydrationWarning><body><ThemeProvider>{children}</ThemeProvider></body></html> }
