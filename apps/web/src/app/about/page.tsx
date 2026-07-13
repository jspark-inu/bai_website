export const dynamic = 'force-static';

export default function AboutPage() {
  return (
    <main className="bai-about">
      <header><a href="/about" className="bai-about-mark">BAI</a><a href="/login">멤버 로그인 →</a></header>
      <section className="bai-about-hero">
        <p>Build with AI · Department AppDev</p>
        <h1>학과의 반복되는 문제를<br />학생이 직접 해결합니다.</h1>
        <p className="bai-about-lede">BAI는 AI를 구경하는 모임이 아니라, 사용자에게 묻고 실제로 쓰이는 결과를 만드는 학생 제작 조직입니다.</p>
      </section>
      <section className="bai-about-grid">
        <article><b>01 · 요청</b><h2>학과 구성원이 문제를 제안합니다.</h2><p>개인 민원이 아니라 여러 사람이 반복해서 겪는 시스템 문제를 다룹니다.</p></article>
        <article><b>02 · 제작</b><h2>학생이 해결하고 검증합니다.</h2><p>BAI 학생은 요청자와 대화하고, 결과물을 만들고, 사용자가 확인할 수 있게 남깁니다.</p></article>
        <article><b>03 · 성장</b><h2>기여가 다음 서비스를 만듭니다.</h2><p>검증된 경험은 개인의 포트폴리오가 되고, 장차 길드가 운영하는 실제 서비스로 이어집니다.</p></article>
      </section>
      <footer>BAI · 내부 작업 피드는 멤버 전용으로 운영됩니다.</footer>
    </main>
  );
}
