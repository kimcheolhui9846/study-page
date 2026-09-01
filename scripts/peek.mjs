/**
 * 실측을 본다. 읽기만 한다.
 *   node scripts/peek.mjs
 */
process.loadEnvFile('.env.local')
const { neon } = await import('@neondatabase/serverless')
const sql = neon(process.env.DATABASE_URL)

console.log('\n─ daily_plans ─')
console.table(await sql`
  SELECT day_number, study_date, status, estimated_calls, estimated_minutes
    FROM daily_plans ORDER BY day_number`)

console.log('\n─ plan_items ─')
console.table(await sql`
  SELECT p.day_number AS day, i.topic_id, i.kind, i.round, i.minutes, i.status,
         (i.answers IS NOT NULL) AS answered, i.score
    FROM plan_items i JOIN daily_plans p ON p.id = i.plan_id
   ORDER BY p.day_number, i.priority DESC`)

console.log('\n─ topic_progress ─')
console.table(await sql`
  SELECT topic_id, status, mastery_score, attempt_count, wrong_count,
         next_review_at, review_round, weak_concepts
    FROM topic_progress ORDER BY topic_id`)

console.log('\n─ 생성된 자료 ─')
console.table(await sql`
  SELECT topic_id, 'content' AS kind, NULL::int AS round, cost_micros FROM topic_contents
   UNION ALL
  SELECT topic_id, 'review', round, NULL FROM review_items
   ORDER BY topic_id, kind`)

console.log('\n─ usage_ledger ─')
console.table(await sql`
  SELECT route, subject, prompt_tokens, completion_tokens, cost_micros, ok
    FROM usage_ledger ORDER BY id`)

console.log('\n─ budget_counters ─')
console.table(await sql`SELECT period_key, calls, cap_calls, cost_micros, cap_micros
                          FROM budget_counters ORDER BY period_key`)

const [sum] = await sql`SELECT COALESCE(SUM(cost_micros), 0)::int AS total FROM usage_ledger`
console.log(`\n총 사용액: $${(sum.total / 1_000_000).toFixed(6)}\n`)
