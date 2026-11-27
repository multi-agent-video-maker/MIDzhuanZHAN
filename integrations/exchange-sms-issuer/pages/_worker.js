export default {
  fetch(request, env) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/sms/keys' || !env.ISSUER) {
      return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }
    return env.ISSUER.fetch(request)
  },
}
