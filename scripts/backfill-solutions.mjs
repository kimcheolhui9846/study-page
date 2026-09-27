/**
 * 해설이 없던 시절에 만들어진 자료에 해설만 채운다.
 *
 *   npx tsx scripts/backfill-solutions.mjs        ← 무엇을 채울지만 본다
 *   npx tsx scripts/backfill-solutions.mjs --run  ← 실제로 채운다
 *
 * (tsx 로 돈다. lib 이 확장자 없는 import 를 쓰므로 node 단독으로는 못 푼다.)
 *
 * ★ 지문과 문제는 그대로 둔다. 학습자가 이미 그 지문을 읽고 그 문제에
 *   답했다. 새로 만들면 복구가 아니라 덮어쓰기다.
 *
 * ★ 예산 게이트(`reserve`)를 그대로 지난다. Topic 하나에 호출 하나다.
 *   캡을 다 썼으면 거기서 멈춘다.
 *
 * 로직은 전부 `lib/llm/solutions.ts` 에 있고 테스트가 붙어 있다.
 * 이 파일은 그걸 부르기만 한다.
 */
process.loadEnvFile('.env.local')

const { db } = await import('../lib/db/client')
const { systemClock } = await import('../lib/time')
const { loadGraph } = await import('../lib/curriculum/load')
const { OpenAiLlmClient } = await import('../lib/llm/client')
const { backfillSolutions, topicsMissingSolutions } = await import('../lib/llm/solutions')

const targets = await topicsMissingSolutions(db)

if (targets.length === 0) {
  console.log('\n해설이 빠진 자료가 없다.\n')
  process.exit(0)
}

console.log(`\n해설이 빠진 자료 ${targets.length}개:`)
for (const id of targets) console.log(`  · ${id}`)

if (!process.argv.includes('--run')) {
  console.log(`\n호출 ${targets.length}회가 나간다. 실제로 채우려면 --run 을 붙인다.\n`)
  process.exit(0)
}

const deps = { db, clock: systemClock, llm: new OpenAiLlmClient(), graph: loadGraph() }

let spent = 0
console.log('')
for (const topicId of targets) {
  const out = await backfillSolutions(deps, topicId)

  if (out.status === 'filled') {
    spent += out.costMicros
    console.log(`  ✅ ${topicId} — 문제 ${out.questions}개 · $${(out.costMicros / 1e6).toFixed(6)}`)
  } else {
    console.log(`  ${out.status === 'skipped' ? '—' : '❌'} ${topicId} — ${out.reason}`)
    // 캡에 걸렸으면 남은 것도 다 걸린다. 헛되이 더 부르지 않는다.
    if (out.reason.includes('호출을 다 썼다')) break
  }
}

console.log(`\n총 $${(spent / 1e6).toFixed(6)}\n`)
