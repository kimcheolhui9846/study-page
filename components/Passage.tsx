import Markdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

export interface PassageProps {
  title: string
  bodyMd: string
  keyTerms: Array<{ term: string; definition: string }>
}

/**
 * LLM 이 만든 마크다운을 그린다.
 *
 * ★ rehype-raw 를 넣지 않는다. react-markdown 은 기본값에서 원시 HTML 을
 * 렌더하지 않으므로, 모델이 <script> 를 뱉어도 텍스트로 남는다.
 * 신뢰할 수 없는 출력을 그리는 화면에서 이 성질이 핵심이다.
 *
 * 본문은 왼쪽 정렬이다. 앱의 나머지는 가운데로 모으지만 700~1000자를
 * 읽는 이 블록만은 예외다 — 양쪽이 다 들쭉날쭉하면 눈이 다음 줄의
 * 시작점을 못 찾는다.
 */
export function Passage({ title, bodyMd, keyTerms }: PassageProps) {
  return (
    <article className="mt-10 flex flex-col rounded-card bg-surface px-5 py-8 shadow-[inset_0_0_0_1px_var(--color-rule)] sm:mt-12 sm:px-9 sm:py-10">
      <h2 className="text-balance text-center font-serif text-[23px] leading-snug tracking-[-0.02em] text-ink sm:text-[28px]">
        {title}
      </h2>

      <div className="mx-auto mt-7 h-px w-12 bg-rule" />

      <div className="mt-8 flex flex-col gap-6 text-pretty text-[16.5px] leading-[1.85] text-body [&_code]:rounded-sm [&_code]:bg-chip [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[14.5px] [&_h3]:mt-2 [&_h3]:font-serif [&_h3]:text-xl [&_h3]:text-ink [&_li]:leading-[1.85] [&_ol]:ml-5 [&_ol]:list-decimal [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:ml-5 [&_ul]:list-disc">
        <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {bodyMd}
        </Markdown>
      </div>

      {keyTerms.length > 0 && (
        <>
          <div className="mt-9 h-px bg-rule-soft" />
          <dl className="mt-6 flex flex-col gap-3">
            {keyTerms.map((t) => (
              <div key={t.term} className="flex flex-col gap-1 text-[13.5px] leading-[1.7] sm:flex-row sm:gap-4">
                <dt className="font-mono text-[12.5px] text-muted sm:w-40 sm:shrink-0">{t.term}</dt>
                <dd className="text-pretty text-body">{t.definition}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </article>
  )
}
