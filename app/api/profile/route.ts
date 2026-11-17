import { forwardMeetingRequest } from '@/lib/meeting-proxy'

export async function GET(request: Request) {
  return forwardMeetingRequest(request, 'profiles/me')
}

export async function PATCH(request: Request) {
  return forwardMeetingRequest(request, 'profiles/me')
}
