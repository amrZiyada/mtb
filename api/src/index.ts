import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { createHash, createHmac } from 'node:crypto'

type Env = { Bindings: { DB: D1Database; ADMIN_PASSWORD_HASH: string; SESSION_SECRET: string; WEB_ORIGIN: string } }
const app = new Hono<Env>()

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || ''
  if (origin && origin === c.env.WEB_ORIGIN) c.header('Access-Control-Allow-Origin', origin)
  c.header('Access-Control-Allow-Credentials', 'true')
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  c.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  if (c.req.method === 'OPTIONS') return c.body(null, 204)
  await next()
})

function digest(value: string) { return createHash('sha256').update(value).digest('hex') }
function sessionToken(secret: string) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 8
  const payload = String(exp)
  const sig = createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${sig}`
}
function validSessionToken(token: string | undefined, secret: string) {
  if (!token) return false
  const [expText, sig] = token.split('.')
  const exp = Number(expText)
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000) || !sig) return false
  const expected = createHmac('sha256', secret).update(String(exp)).digest('hex')
  return sig === expected
}
function authed(c: any) {
  const auth = c.req.header('Authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : undefined
  const cookie = getCookie(c, 'admin_session')
  return validSessionToken(bearer || cookie, c.env.SESSION_SECRET)
}

async function ensureAdminTable(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS admin_users(
    id INTEGER PRIMARY KEY CHECK(id=1),
    password_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()
}

app.get('/tests', async c => {
  const q = String(c.req.query('q') || '').trim().toLowerCase()
  if (!q) return c.json({ tests: [] })

  const like = `%${q}%`
  const { results } = await c.env.DB.prepare(`
    SELECT test_no, analysis_name, unit, ref_range, specimen, duration,
           price, contract_price, patient_price
    FROM tests
    WHERE active=1
      AND (
        LOWER(analysis_name) LIKE ? OR
        LOWER(test_no) LIKE ? OR
        LOWER(unit) LIKE ? OR
        LOWER(ref_range) LIKE ? OR
        LOWER(specimen) LIKE ?
      )
    ORDER BY
      CASE
        WHEN LOWER(test_no)=? THEN 0
        WHEN LOWER(analysis_name)=? THEN 1
        WHEN LOWER(test_no) LIKE ? THEN 2
        WHEN LOWER(analysis_name) LIKE ? THEN 3
        ELSE 4
      END,
      analysis_name ASC
    LIMIT 5
  `).bind(
    like, like, like, like, like,
    q, q, `${q}%`, `${q}%`
  ).all()

  return c.json({ tests: results || [] })
})

app.post('/bookings', async c => {
  const b = await c.req.json()
  if (!b.patient_name || !b.phone || !Array.isArray(b.tests) || !b.tests.length) return c.json({ error: 'Invalid booking' }, 400)
  if (String(b.patient_name).length > 120 || String(b.phone).length > 40) return c.json({ error: 'Invalid fields' }, 400)

  const codes = b.tests.map((t: any) => String(t.code)).slice(0, 100)
  const placeholders = codes.map(() => '?').join(',')
  const { results } = await c.env.DB.prepare(`SELECT test_no, analysis_name, specimen, patient_price FROM tests WHERE active=1 AND test_no IN (${placeholders})`).bind(...codes).all()
  if (!results.length) return c.json({ error: 'No valid tests selected' }, 400)
  const byCode = new Map(results.map((r: any) => [String(r.test_no), r]))
  const selected = codes.map((code: string) => byCode.get(code)).filter(Boolean)
  const total = selected.reduce((sum: number, t: any) => sum + Number(t.patient_price || 0), 0)
  const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(3)))
  .map(b => b.toString(16).padStart(2, '0'))
  .join('')
  .toUpperCase()

const reference = 'LAB-' + Date.now().toString(36).toUpperCase() + '-' + randomHex

  await c.env.DB.prepare(`INSERT INTO bookings(reference,patient_name,age,gender,phone,preferred_at,address,tests_json,total)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(
      reference, String(b.patient_name), Number(b.age) || null, b.gender || null, String(b.phone),
      b.preferred_at || null, b.address || null, JSON.stringify(selected), total
    ).run()
  return c.json({ reference, total })
})

app.post('/admin/login', async c => {
  const { password } = await c.req.json()
  await ensureAdminTable(c.env.DB)
  const row = await c.env.DB.prepare('SELECT password_hash FROM admin_users WHERE id=1').first<any>()
  const stored = row?.password_hash || c.env.ADMIN_PASSWORD_HASH
  if (!stored || digest(String(password || '')) !== stored) return c.json({ error: 'Invalid password' }, 401)

  if (!row?.password_hash && c.env.ADMIN_PASSWORD_HASH) {
    await c.env.DB.prepare('INSERT OR REPLACE INTO admin_users(id,password_hash,updated_at) VALUES(1,?,CURRENT_TIMESTAMP)')
      .bind(c.env.ADMIN_PASSWORD_HASH).run()
  }

  const token = sessionToken(c.env.SESSION_SECRET)
  setCookie(c, 'admin_session', token, { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 60 * 60 * 8 })
  return c.json({ ok: true, token })
})

app.get('/admin/bookings', async c => {
  if (!authed(c)) return c.json({ error: 'Unauthorized' }, 401)
  const { results } = await c.env.DB.prepare(`SELECT * FROM bookings
    ORDER BY CASE WHEN preferred_at IS NULL OR preferred_at='' THEN 1 ELSE 0 END, preferred_at ASC, created_at DESC
    LIMIT 500`).all()
  return c.json({ bookings: results })
})

app.delete('/admin/bookings/:reference', async c => {
  if (!authed(c)) return c.json({ error: 'Unauthorized' }, 401)
  const reference = String(c.req.param('reference') || '').trim()
  if (!reference) return c.json({ error: 'Invalid booking reference' }, 400)
  const result = await c.env.DB.prepare('DELETE FROM bookings WHERE reference=?').bind(reference).run()
  if (!result.meta.changes) return c.json({ error: 'Booking not found' }, 404)
  return c.json({ ok: true, reference })
})

app.get('/admin/tests', async c => {
  if (!authed(c)) return c.json({ error: 'Unauthorized' }, 401)
  const q = String(c.req.query('q') || '').trim().toLowerCase()
  if (!q) return c.json({ tests: [] })

  const like = `%${q}%`
  const { results } = await c.env.DB.prepare(`
    SELECT test_no, analysis_name, unit, specimen, patient_price, active
    FROM tests
    WHERE active=1
      AND (
        LOWER(test_no) LIKE ? OR
        LOWER(analysis_name) LIKE ? OR
        LOWER(unit) LIKE ? OR
        LOWER(specimen) LIKE ?
      )
    ORDER BY
      CASE
        WHEN LOWER(test_no)=? THEN 0
        WHEN LOWER(analysis_name)=? THEN 1
        WHEN LOWER(test_no) LIKE ? THEN 2
        WHEN LOWER(analysis_name) LIKE ? THEN 3
        ELSE 4
      END,
      analysis_name ASC
    LIMIT 5
  `).bind(
    like, like, like, like,
    q, q, `${q}%`, `${q}%`
  ).all()
  return c.json({ tests: results || [] })
})

app.post('/admin/tests/price', async c => {
  if (!authed(c)) return c.json({ error: 'Unauthorized' }, 401)
  const b = await c.req.json()
  const testNo = String(b.test_no || '').trim()
  const price = Number(b.patient_price)
  if (!testNo || !Number.isFinite(price) || price < 0) return c.json({ error: 'Invalid test number or price' }, 400)
  const result = await c.env.DB.prepare(`
    UPDATE tests SET patient_price=?, price=?, updated_at=CURRENT_TIMESTAMP WHERE test_no=?
  `).bind(price, price, testNo).run()
  if (!result.meta.changes) return c.json({ error: 'Test not found' }, 404)
  return c.json({ ok: true, test_no: testNo, patient_price: price })
})

app.post('/admin/change-password', async c => {
  if (!authed(c)) return c.json({ error: 'Unauthorized' }, 401)
  const { current_password, new_password } = await c.req.json()
  const current = String(current_password || '')
  const next = String(new_password || '')
  if (next.length < 1) return c.json({ error: 'New password is required' }, 400)
  await ensureAdminTable(c.env.DB)
  const row = await c.env.DB.prepare('SELECT password_hash FROM admin_users WHERE id=1').first<any>()
  const stored = row?.password_hash || c.env.ADMIN_PASSWORD_HASH
  if (!stored || digest(current) !== stored) return c.json({ error: 'Current password is incorrect' }, 401)
  await c.env.DB.prepare('INSERT OR REPLACE INTO admin_users(id,password_hash,updated_at) VALUES(1,?,CURRENT_TIMESTAMP)')
    .bind(digest(next)).run()
  return c.json({ ok: true })
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
      Number(t.duration) || 0, Number(t.price) || Number(t.patient_price) || 0,
      Number(t.contract_price) || 0, Number(t.patient_price)
    ))
  }
  await c.env.DB.batch(statements)
  return c.json({ count: tests.length })
})

app.get('/health', c => c.json({ ok: true }))
export default app
