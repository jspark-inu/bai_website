import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { MarkdownBody } from '@/components/MarkdownBody';
import { getCurrentMember } from '@/lib/auth';
import { getProject, listPostsByProject } from '@/lib/db';

export default async function Page({ params }: { params: Promise<{ pid: string }> }) {
  const member = await getCurrentMember();
  if (!member) redirect('/login');
  const { pid } = await params;
  const project = getProject(Number(pid));
  if (!project) notFound();
  const posts = listPostsByProject(Number(project.id));

  return (
    <AppShell member={member}>
      <section className="page-head">
        <div>
          <p className="eyebrow">Project</p>
          <h1>{String(project.title ?? '')}</h1>
          <p>{[project.type, project.status, project.owner_name].filter(Boolean).join(' · ')}</p>
        </div>
      </section>
      <section className="resource-grid">
        <article className="resource-card">
          <h2>개요</h2>
          {project.summary ? <p>{String(project.summary)}</p> : null}
          {project.goal ? <p>{String(project.goal)}</p> : null}
          {project.next_milestone ? <p>다음: {String(project.next_milestone)}</p> : null}
        </article>
        <article className="resource-card">
          <h2>링크</h2>
          <div className="resource-links">
            {project.repo_url ? <a href={String(project.repo_url)} target="_blank" rel="noreferrer">GitHub</a> : null}
            {project.site_url ? <a href={String(project.site_url)} target="_blank" rel="noreferrer">Demo</a> : null}
          </div>
        </article>
      </section>
      <section className="stack-list">
        {posts.length ? posts.map((post) => (
          <article className="feed-card" key={String(post.id)}>
            <div className="card-meta">{String(post.author_name ?? '')} · {String(post.created_at ?? '').slice(0, 10)}</div>
            {post.did ? <MarkdownBody body={String(post.did)} /> : null}
            {post.learned ? <MarkdownBody body={String(post.learned)} /> : null}
            {post.blocked ? <MarkdownBody body={String(post.blocked)} /> : null}
          </article>
        )) : <div className="empty-state">연결된 진행 공유가 없습니다.</div>}
      </section>
    </AppShell>
  );
}
