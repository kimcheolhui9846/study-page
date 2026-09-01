/**
 * 실측을 본다. 읽기만 한다.
 *   node scripts/peek.mjs
 */
process.loadEnvFile('.env.local')
const { neon } = await import('@neondatabase/serverless')
const sql = neon(process.env.DATABASE_URL)

console.log('\n─ usage_ledger ─')
console.table(await sql`
  SELECT route, model, prompt_tokens, completion_tokens, cost_micros, ok
    FROM usage_ledger ORDER BY id`)

console.log('\n─ budget_counters ─')
console.table(await sql`SELECT period_key, calls, cost_micros, cap_calls, cap_micros
                          FROM budget_counters ORDER BY period_key`)

console.log('\n─ study_days ─')
console.table(await sql`SELECT subject, day_no, study_date, status FROM study_days
                          ORDER BY subject, day_no`)

console.log('\n─ attempts ─')
console.table(await sql`SELECT study_day_id, attempt_no, (feedback IS NOT NULL) AS graded
                          FROM attempts ORDER BY study_day_id, attempt_no`)

const [sum] = await sql`SELECT COALESCE(SUM(cost_micros), 0)::int AS total FROM usage_ledger`
console.log(`\n총 사용액: $${(sum.total / 1_000_000).toFixed(4)}\n`)
