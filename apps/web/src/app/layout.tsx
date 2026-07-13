import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BAI 진행 공유',
  description: 'BAI 주간 기록·질문·프로젝트 진행 공유',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
