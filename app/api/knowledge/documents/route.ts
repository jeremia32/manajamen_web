import { NextResponse } from 'next/server'
import { getDocuments } from '@/lib/sources-store'
export async function GET(request: Request) { const params = new URL(request.url).searchParams; const q = params.get('q')?.toLowerCase(); const sourceId = params.get('sourceId'); const status = params.get('status'); const documents = getDocuments().filter(doc => (!q || doc.name.toLowerCase().includes(q)) && (!sourceId || doc.sourceId === sourceId) && (!status || doc.status === status)); return NextResponse.json(documents) }
