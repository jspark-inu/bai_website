import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { MarkdownBody } from '@/components/MarkdownBody';
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
          <p className="eyebrow">Questions</p>
          <h1>질문과 막힌 점</h1>
          <p>진행 공유에서 막힌 점이 있는 항목을 모아 봅니다.</p>
        </div>
      </section>
      <section className="stack-list">
        {questions.length ? questions.map((post) => (
          <article className="feed-card" key={String(post.id)}>
            <div className="card-meta">{String(post.author_name ?? '')} · {String(post.created_at ?? '').slice(0, 10)}</div>
            <MarkdownBody body={String(post.blocked ?? '')} />
          </article>
        )) : <div className="empty-state">현재 열린 질문이 없습니다.</div>}
      </section>
    </AppShell>
  );
}
