export function forwardAuthorization(request: Request, headers?: HeadersInit): Headers {
	const forwardedHeaders = new Headers(headers)
	const authorization = request.headers.get('authorization')
	if (authorization) forwardedHeaders.set('Authorization', authorization)
	return forwardedHeaders
}
