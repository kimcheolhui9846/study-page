import type { Metadata } from "next";
import { Gowun_Batang, IBM_Plex_Mono, IBM_Plex_Sans_KR } from "next/font/google";
import "./globals.css";

// next/font 는 구글에 subset 파라미터를 보내지 않는다. 한글 @font-face 까지
// 전부 내려받아 자체 호스팅하므로 한글은 정상 렌더된다.
// 여기 적은 subsets 는 preload 대상만 고르는 것이다.
const serif = Gowun_Batang({
  variable: "--font-gowun-batang",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const sans = IBM_Plex_Sans_KR({
  variable: "--font-plex-sans-kr",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "오늘의 공부",
  description: "영어 · 수학 · CS — 하루 한 번.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${serif.variable} ${sans.variable} ${mono.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
