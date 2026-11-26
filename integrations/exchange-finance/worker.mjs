const orderID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const secret = /^[a-f0-9]{64}$/
const timestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
const rowLimit = 200
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

async function authorized(request, key) {
  const supplied = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
  if (!supplied || !secret.test(key ?? '')) return false
  const encoder = new TextEncoder()
  const [given, expected] = await Promise.all(
    [supplied, key].map((value) => crypto.subtle.digest('SHA-256', encoder.encode(value)))
  )
  const a = new Uint8Array(given)
  const b = new Uint8Array(expected)
  let difference = 0
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index]
  return difference === 0
}

export async function readFinance(request, env) {
  const url = new URL(request.url)
  if (url.pathname !== '/finance' || request.method !== 'GET' || !await authorized(request, env.ALLFUN_EXCHANGE_FINANCE_KEY)) {
    return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404, headers })
  }
  const id = url.searchParams.get('order')
  const from = url.searchParams.get('from')
  const until = url.searchParams.get('until')
  if ((id !== null && (!orderID.test(id) || from !== null || until !== null)) ||
      ((from !== null || until !== null) && (!timestamp.test(from ?? '') || !timestamp.test(until ?? '') || from >= until))) {
    return Response.json({ error: { code: 'INVALID_INPUT' } }, { status: 400, headers })
  }
  try {
    const db = env.DB.withSession ? env.DB.withSession('first-primary') : env.DB
    // Read confirmed sales and settled SMS costs without querying credentials,
    // receipt hashes, voucher contents, phone numbers or verification codes.
    const conditions = []
    const args = []
    if (id !== null) {
      conditions.push('id = ?')
      args.push(id)
    }
    if (from !== null) {
      conditions.push('confirmed_at >= ?', 'confirmed_at < ?')
      args.push(from, until)
    }
    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''
    const result = await db.prepare(
      "WITH ledger AS (" +
      " SELECT s.id, s.type AS channel, s.name, s.status, s.confirmed_at, " +
      " CASE WHEN o.settled = 1 AND o.status = 'completed' THEN o.amount_cents END AS cost_cents " +
      " FROM shop_orders s LEFT JOIN access_keys k ON k.id = s.id AND s.type = 'sms' " +
      " LEFT JOIN orders o ON o.id = k.redemption_id AND o.owner_id = k.id " +
      " WHERE s.confirmed_at IS NOT NULL AND s.status IN ('approving','fulfilled') " +
      " UNION ALL SELECT o.id, 'sms', 'SMS key', 'fulfilled', o.updated_at, o.amount_cents " +
      " FROM orders o WHERE o.settled = 1 AND o.status = 'completed' " +
      " AND NOT EXISTS (SELECT 1 FROM shop_orders s WHERE s.id = o.owner_id) " +
      " UNION ALL SELECT p.id, 'membership', CASE p.plan WHEN 'pro5' THEN 'Pro 5x' ELSE 'Plus' END, " +
      " 'fulfilled', p.updated_at, NULL FROM plus_orders p WHERE p.charge_status = 'success'" +
      ") SELECT id, channel, name, status, confirmed_at, cost_cents FROM ledger" +
      where + ' ORDER BY confirmed_at DESC, id DESC LIMIT ?'
    ).bind(...args, rowLimit + 1).all()
    return Response.json({
      data: {
        orders: result.results.slice(0, rowLimit), limited: result.results.length > rowLimit,
      },
    }, { headers })
  } catch {
    return Response.json({ error: { code: 'UNAVAILABLE' } }, { status: 503, headers })
  }
}

export default { fetch: (request, env) => readFinance(request, env) }
