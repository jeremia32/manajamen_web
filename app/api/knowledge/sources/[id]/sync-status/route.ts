import { NextResponse } from 'next/server'
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; return NextResponse.json({ sourceId: id, status: 'success', progress: 100, message: 'Sinkronisasi selesai.' }) }
