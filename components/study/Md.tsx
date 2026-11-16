import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

/**
 * 모델이 쓴 마크다운. components/Passage.tsx 와 같은 렌더러다.
 *
 * remark-gfm — CS 비교·코테 입출력에 표가 필요하다.
 * ★ rehype-raw 를 넣지 않는다 — 원시 HTML 은 텍스트로 남는다.
 */
export function Md({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-3 text-pretty text-[15px] leading-[1.8] text-body [&_code]:rounded-sm [&_code]:bg-chip [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13.5px] [&_pre]:overflow-x-auto [&_pre]:rounded-control [&_pre]:bg-note [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_h3]:font-serif [&_h3]:text-lg [&_h3]:text-ink [&_ol]:ml-5 [&_ol]:list-decimal [&_strong]:font-semibold [&_strong]:text-ink [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-rule [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-rule [&_th]:bg-note [&_th]:px-2 [&_th]:py-1 [&_ul]:ml-5 [&_ul]:list-disc ${className}`}>
      <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {children}
      </Markdown>
    </div>
  )
}
