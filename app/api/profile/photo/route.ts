import { forwardMeetingRequest } from '@/lib/meeting-proxy'

export async function POST(request: Request) {
  return forwardMeetingRequest(request, 'profiles/me/photo')
}
