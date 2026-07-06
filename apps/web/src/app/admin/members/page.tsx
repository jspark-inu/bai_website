import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { getCurrentMember } from '@/lib/auth';
import { listMembersWithStats } from '@/lib/db';

export default async function Page() {
  const member = await getCurrentMember();
  if (!member) redirect('/login');
  if (member.role !== 'pi') redirect('/members');
  const members = listMembersWithStats();

  return (
    <AppShell member={member}>
      <section className="page-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>멤버 관리</h1>
          <p>활성 멤버와 활동량을 운영자 관점에서 확인합니다.</p>
        </div>
      </section>
      <section className="table-wrap">
        <table>
          <thead><tr><th>이름</th><th>역할</th><th>글</th><th>최근 공유</th></tr></thead>
          <tbody>
            {members.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.role}</td>
                <td>{row.post_count}</td>
                <td>{row.last_post_at ? row.last_post_at.slice(0, 10) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AppShell>
  );
}
