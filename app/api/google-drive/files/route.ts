import { forwardGoogleDrive } from '@/lib/google-drive-proxy'

export async function GET(request: Request) {
  return forwardGoogleDrive(request, '/google-drive/files')
}
