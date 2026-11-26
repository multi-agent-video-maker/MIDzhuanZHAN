export default {
  fetch(request, env) {
    if (request.method !== 'GET' || new URL(request.url).pathname !== '/finance' || !env.FINANCE) {
      return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }
    return env.FINANCE.fetch(request)
  },
}
