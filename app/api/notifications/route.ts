import { forwardMeetingRequest } from '@/lib/meeting-proxy'

export async function GET(request: Request) {
  return forwardMeetingRequest(request, 'notifications')
}
