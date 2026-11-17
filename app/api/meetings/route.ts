import { forwardMeetingRequest } from '@/lib/meeting-proxy'

export async function GET(request: Request) {
  return forwardMeetingRequest(request, 'meetings')
}

export async function POST(request: Request) {
  return forwardMeetingRequest(request, 'meetings')
}
