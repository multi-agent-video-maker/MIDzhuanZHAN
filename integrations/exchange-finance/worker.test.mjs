import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { readFinance } from './worker.mjs'

const key = 'a'.repeat(64)
const today = '2026-11-25T00:00:00.000Z'
const numbers = {
  order: '50f0e6e3-1471-4f39-90d9-9c2ebc24d52a',
  sms: '316508cd-fbd3-4f51-a6f8-39879d954c7d',
  manual: '48c5194b-beae-492d-9b2d-9fec13867991',
  member: '6812a581-6286-4eab-b02f-241269d43deb',
}

function request(path, bearer, method = 'GET') {
  return new Request('https://finance.example.test' + path, {
    method, headers: { Authorization: 'Bearer ' + bearer },
  })
}

test('the machine credential allows only read-only finance', async () => {
  const env = { ALLFUN_EXCHANGE_FINANCE_KEY: key }
  for (const item of [
    request('/finance', 'b'.repeat(64)),
    request('/finance', key, 'POST'),
    request('/admin', key),
  ]) {
    assert.equal((await readFinance(item, env)).status, 404)
  }
})

test('the ledger counts charged SMS once and exposes only financial rows', async (context) => {
  const database = new DatabaseSync(':memory:')
  context.after(() => database.close())
  database.exec(
    'CREATE TABLE shop_orders(id, type, name, status, confirmed_at, delivery_cipher);' +
    'CREATE TABLE access_keys(id, redemption_id);' +
    'CREATE TABLE orders(id, owner_id, settled, status, updated_at, amount_cents, sms_code);' +
    'CREATE TABLE plus_orders(id, plan, charge_status, updated_at);'
  )
  const shop = database.prepare('INSERT INTO shop_orders VALUES (?,?,?,?,?,?)')
  shop.run(numbers.order, 'sms', 'SMS', 'fulfilled', today, 'private delivery')
  shop.run(numbers.member, 'membership', 'Pro', 'approving', today, 'private voucher')
  shop.run('unpaid', 'membership', 'Plus', 'pending', null, null)
  database.prepare('INSERT INTO access_keys VALUES (?,?)').run(numbers.order, numbers.sms)
  const sms = database.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?)')
  sms.run(numbers.sms, numbers.order, 1, 'completed', today, 27, 'private SMS')
  sms.run(numbers.manual, 'legacy', 1, 'completed', today, 19, 'private SMS')
  sms.run('cancelled', 'legacy', 1, 'cancelled', today, 35, null)
  const env = {
    ALLFUN_EXCHANGE_FINANCE_KEY: key,
    DB: { prepare: (sql) => ({ bind: (...args) => ({ all: async () => ({ results: database.prepare(sql).all(...args) }) }) }) },
  }
  const response = await readFinance(request('/finance', key), env)
  assert.equal(response.status, 200)
  const { data } = await response.json()
  assert.deepEqual(Object.fromEntries(data.orders.map((order) => [order.id, order.cost_cents])), {
    [numbers.order]: 27, [numbers.manual]: 19, [numbers.member]: null,
  })
  assert.doesNotMatch(JSON.stringify(data), /private/)
  const individual = await readFinance(request('/finance?order=' + numbers.member, key), env)
  assert.deepEqual((await individual.json()).data.orders.map((row) => row.id), [numbers.member])
})
