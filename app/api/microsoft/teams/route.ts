import { forwardMicrosoft } from '@/lib/microsoft-proxy'

export async function GET(request: Request) {
  return forwardMicrosoft(request, '/microsoft/teams')
}
