import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { getCurrentMember } from '@/lib/auth';
import { listOpenQuestions } from '@/lib/db';

export default async function Page() {
  const member = await getCurrentMember();
  if (!member) redirect('/login');
  const questions = listOpenQuestions();

  return (
    <AppShell member={member}>
      <section className="page-head">
        <div>
          <p className="eyebrow">Ask</p>
          <h1>도움 요청</h1>
          <p>막힌 점이 남아있는 공유를 기준으로 도움 요청을 확인합니다.</p>
        </div>
      </section>
      <section className="resource-grid">
        <article className="resource-card">
          <div className="card-meta">Open</div>
          <h2>{questions.length}개</h2>
          <p>현재 답변이나 후속 확인이 필요한 항목입니다.</p>
        </article>
      </section>
    </AppShell>
  );
}
