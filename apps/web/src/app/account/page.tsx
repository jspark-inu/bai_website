import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { getCurrentMember } from '@/lib/auth';

export default async function Page() {
  const member = await getCurrentMember();
  if (!member) redirect('/login');

  return (
    <AppShell member={member}>
      <section className="page-head">
        <div>
          <p className="eyebrow">Account</p>
          <h1>내 계정</h1>
          <p>현재 로그인된 BAI 멤버 정보를 확인합니다.</p>
        </div>
      </section>
      <section className="resource-grid">
        <article className="resource-card">
          <div className="card-meta">{member.role}</div>
          <h2>{member.name}</h2>
          <p>멤버 ID {member.id}</p>
        </article>
      </section>
    </AppShell>
  );
}
