import { NextResponse } from 'next/server'
import { getSyncRuns } from '@/lib/sources-store'
export async function GET() { return NextResponse.json(getSyncRuns()) }
