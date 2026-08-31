import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // 상위 디렉터리에 다른 package-lock.json 이 있어 Turbopack 이 루트를 잘못 추론한다.
  // 이 디렉터리가 프로젝트 루트임을 명시한다.
  turbopack: {
    root: import.meta.dirname,
  },
}

export default nextConfig
