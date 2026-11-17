import { forwardMeetingRequest } from '@/lib/meeting-proxy'

type RouteContext = { params: Promise<{ segments: string[] }> }

async function handle(request: Request, context: RouteContext) {
  const { segments } = await context.params
  return forwardMeetingRequest(request, `notifications/${segments.map(segment => encodeURIComponent(segment)).join('/')}`)
}

export const POST = handle
