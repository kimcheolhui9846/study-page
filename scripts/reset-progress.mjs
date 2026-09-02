/**
 * 학습 기록을 지운다. 되돌릴 수 없다.
 *
 *   node scripts/reset-progress.mjs --yes
 *
 * 검증용으로 돌린 기록을 지우고 처음부터 공부할 때 쓴다.
 *
 * ★ 쓴 돈의 기록(usage_ledger)은 남긴다. 지우면 /admin/usage 가 이번 달
 *   실제 지출에 대해 거짓말을 하게 된다. 나간 돈은 나간 돈이다.
 *
 * ★ 예산 카운터는 캡만 고친다. 횟수와 금액은 건드리지 않는다.
 *   reserve() 가 행을 처음 만들 때의 캡을 행에 굳혀 넣기 때문에,
 *   로컬에서 만들어진 행은 배포 뒤에도 로컬 캡(3회 / $0.50)을 들고 있다.
 */
process.loadEnvFile('.env.local')

if (!process.argv.includes('--yes')) {
  console.error('되돌릴 수 없다. 정말 지우려면 --yes 를 붙인다.')
  process.exit(1)
}

const { neon } = await import('@neondatabase/serverless')
const sql = neon(process.env.DATABASE_URL)

// 지운다 — 학습 기록과 생성된 자료
const plans = await sql`DELETE FROM daily_plans RETURNING id` // plan_items 는 CASCADE
const progress = await sql`DELETE FROM topic_progress RETURNING topic_id`
const contents = await sql`DELETE FROM topic_contents RETURNING topic_id`
const reviews = await sql`DELETE FROM review_items RETURNING id`

console.log(
  `계획 ${plans.length} · 진도 ${progress.length} · ` +
  `자료 ${contents.length} · 복습자료 ${reviews.length} 삭제`,
)

// 고친다 — 캡만 production 값으로
const caps = await sql`
  UPDATE budget_counters
     SET cap_calls  = CASE WHEN period_key LIKE 'day:%' THEN 20 ELSE 100000 END,
         cap_micros = 3000000
   RETURNING period_key, calls, cap_calls, cost_micros, cap_micros`
console.table(caps)

// 남은 것을 확인한다
const [ledger] = await sql`SELECT COUNT(*)::int AS n FROM usage_ledger`
const [spent] = await sql`SELECT COALESCE(SUM(cost_micros), 0)::int AS n FROM usage_ledger`
const [settings] = await sql`SELECT target_day_count, daily_study_minutes FROM users LIMIT 1`

console.log(`\n남긴 것 — 원장 ${ledger.n}건 ($${(spent.n / 1_000_000).toFixed(6)}) · ` +
  `설정 ${settings.target_day_count}일 / 하루 ${settings.daily_study_minutes}분\n`)
