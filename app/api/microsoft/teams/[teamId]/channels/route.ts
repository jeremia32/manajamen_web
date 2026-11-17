import { forwardMicrosoft } from '@/lib/microsoft-proxy'

export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  return forwardMicrosoft(request, `/microsoft/teams/${encodeURIComponent(teamId)}/channels`)
}
