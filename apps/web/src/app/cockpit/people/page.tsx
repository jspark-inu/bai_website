import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { getCurrentMember } from '@/lib/auth';
import { listMembersWithStats } from '@/lib/db';

export default async function Page() {
  const member = await getCurrentMember();
  if (!member) redirect('/login');
  const members = listMembersWithStats();

  return (
    <AppShell member={member}>
      <section className="page-head">
        <div>
          <p className="eyebrow">People</p>
          <h1>멤버 활동</h1>
          <p>멤버별 공유량과 최근 활동을 운영 관점에서 확인합니다.</p>
        </div>
      </section>
      <section className="resource-grid">
        {members.map((row) => (
          <article className="resource-card" key={row.id}>
            <div className="card-meta">{row.role}</div>
            <h2>{row.name}</h2>
            <p>글 {row.post_count}개</p>
            <p className="card-meta">{row.last_post_at ? row.last_post_at.slice(0, 10) : '최근 활동 없음'}</p>
          </article>
        ))}
      </section>
    </AppShell>
  );
}
