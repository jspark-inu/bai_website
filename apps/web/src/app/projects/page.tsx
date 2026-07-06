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
      <section className="page-head"><div><p className="eyebrow">Projects</p><h1>프로젝트</h1><p>BAI 산출물과 진행 단계를 모아 봅니다.</p></div></section>
      <section className="resource-grid">
        {projects.length ? projects.map((project) => (
          <article className="resource-card" key={String(project.id)}>
            <div className="card-meta">{[project.type, project.status, project.owner_name].filter(Boolean).join(' · ')}</div>
            <h2>{String(project.title ?? '')}</h2>
            {project.summary ? <p>{String(project.summary)}</p> : null}
            <div className="resource-links">
              {project.repo_url ? <a href={String(project.repo_url)} target="_blank" rel="noreferrer">GitHub</a> : null}
              {project.site_url ? <a href={String(project.site_url)} target="_blank" rel="noreferrer">Demo</a> : null}
            </div>
          </article>
        )) : <div className="empty-state">등록된 프로젝트가 없습니다.</div>}
      </section>
    </AppShell>
  );
}
