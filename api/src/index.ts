import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { createHash, randomBytes } from 'node:crypto'

type Env = { Bindings: { DB: D1Database; ADMIN_PASSWORD_HASH: string; SESSION_SECRET: string; WEB_ORIGIN: string } }
const app = new Hono<Env>()

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || ''
  if (origin && origin === c.env.WEB_ORIGIN) c.header('Access-Control-Allow-Origin', origin)
  c.header('Access-Control-Allow-Credentials', 'true')
  c.header('Access-Control-Allow-Headers', 'Content-Type')
  c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (c.req.method === 'OPTIONS') return c.body(null, 204)
  await next()
})

function digest(value: string) { return createHash('sha256').update(value).digest('hex') }
function sessionToken(secret: string) { return digest(secret) }
function authed(c: any) { return getCookie(c, 'admin_session') === sessionToken(c.env.SESSION_SECRET) }
function bool(value: unknown) { return ['true', '1', 1, true, 'yes', 'YES'].includes(value as any) ? 1 : 0 }

app.get('/tests', async c => {
  const { results } = await c.env.DB.prepare(`
    SELECT test_no, analysis_name, unit, ref_range, specimen, duration, price, contract_price, patient_price
    FROM tests WHERE active=1 ORDER BY analysis_name COLLATE NOCASE
  `).all()
  return c.json({ tests: results })
})

app.post('/bookings', async c => {
  const b = await c.req.json()
  if (!b.patient_name || !b.phone || !Array.isArray(b.tests) || !b.tests.length) return c.json({ error: 'Invalid booking' }, 400)
  if (String(b.patient_name).length > 120 || String(b.phone).length > 40) return c.json({ error: 'Invalid fields' }, 400)

  // Recalculate from the live catalog. Never trust the browser's total.
  const codes = b.tests.map((t: any) => String(t.code)).slice(0, 100)
  const placeholders = codes.map(() => '?').join(',')
  const { results } = await c.env.DB.prepare(`SELECT test_no, analysis_name, specimen, patient_price FROM tests WHERE active=1 AND test_no IN (${placeholders})`).bind(...codes).all()
  if (!results.length) return c.json({ error: 'No valid tests selected' }, 400)
  const byCode = new Map(results.map((r: any) => [String(r.test_no), r]))
  const selected = codes.map(code => byCode.get(code)).filter(Boolean)
  const total = selected.reduce((sum: number, t: any) => sum + Number(t.patient_price || 0), 0)
  const reference = 'LAB-' + Date.now().toString(36).toUpperCase() + '-' + randomBytes(3).toString('hex').toUpperCase()

  await c.env.DB.prepare(`INSERT INTO bookings(reference,patient_name,age,gender,phone,preferred_at,address,tests_json,total)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(
      reference, String(b.patient_name), Number(b.age) || null, b.gender || null, String(b.phone),
      b.preferred_at || null, b.address || null, JSON.stringify(selected), total
    ).run()
  return c.json({ reference, total })
})

app.post('/admin/login', async c => {
  const { password } = await c.req.json()
  const stored = c.env.ADMIN_PASSWORD_HASH
  if (!stored || digest(String(password || '')) !== stored) return c.json({ error: 'Invalid password' }, 401)
  setCookie(c, 'admin_session', sessionToken(c.env.SESSION_SECRET), { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 60 * 60 * 8 })
  return c.json({ ok: true })
})

app.get('/admin/bookings', async c => {
  if (!authed(c)) return c.json({ error: 'Unauthorized' }, 401)
  const { results } = await c.env.DB.prepare('SELECT * FROM bookings ORDER BY created_at DESC LIMIT 500').all()
  return c.json({ bookings: results })
})

app.post('/admin/tests/import', async c => {
  if (!authed(c)) return c.json({ error: 'Unauthorized' }, 401)
  const { tests } = await c.req.json()
  if (!Array.isArray(tests) || tests.length > 5000) return c.json({ error: 'Invalid catalog' }, 400)

  const statements = []
  for (const t of tests) {
    if (!t.test_no || !t.analysis_name || !Number.isFinite(Number(t.patient_price))) {
      return c.json({ error: `Invalid row: ${t.test_no || t.analysis_name || 'unknown'}` }, 400)
    }
    statements.push(c.env.DB.prepare(`
      INSERT INTO tests(test_no,analysis_name,unit,ref_range,specimen,duration,price,contract_price,patient_price,active,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP)
      ON CONFLICT(test_no) DO UPDATE SET
        analysis_name=excluded.analysis_name, unit=excluded.unit, ref_range=excluded.ref_range,
        specimen=excluded.specimen, duration=excluded.duration, price=excluded.price,
        contract_price=excluded.contract_price, patient_price=excluded.patient_price,
        active=1, updated_at=CURRENT_TIMESTAMP
    `).bind(
      String(t.test_no), String(t.analysis_name), String(t.unit || ''), String(t.ref_range || ''), String(t.specimen || ''),
      Number(t.duration) || 0, Number(t.price) || 0, Number(t.contract_price) || 0, Number(t.patient_price)
    ))
  }
  await c.env.DB.batch(statements)
  return c.json({ count: tests.length })
})

app.get('/health', c => c.json({ ok: true }))
export default app
