import { forwardMicrosoft } from '@/lib/microsoft-proxy'

export async function POST(request: Request) {
  return forwardMicrosoft(request, '/microsoft/messages/sync', 'POST', await request.json())
}
