import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { getCurrentMember } from '@/lib/auth';
import { listProjects } from '@/lib/db';

export default async function Page() {
  const member = await getCurrentMember();
  if (!member) redirect('/login');
  const projects = listProjects();

  return (
    <AppShell member={member}>
      <section className="page-head">
        <div>
          <p className="eyebrow">Projects</p>
          <h1>프로젝트 운영</h1>
          <p>상태, 리스크, 다음 마일스톤을 프로젝트별로 확인합니다.</p>
        </div>
      </section>
      <section className="resource-grid">
        {projects.map((project) => (
          <article className="resource-card" key={String(project.id)}>
            <div className="card-meta">{[project.status, project.risk_level, project.owner_name].filter(Boolean).join(' · ')}</div>
            <h2>{String(project.title ?? '')}</h2>
            {project.next_milestone ? <p>다음: {String(project.next_milestone)}</p> : null}
            {project.pi_decision ? <p>결정: {String(project.pi_decision)}</p> : null}
          </article>
        ))}
      </section>
    </AppShell>
  );
}
