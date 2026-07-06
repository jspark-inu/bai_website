import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { MarkdownBody } from '@/components/MarkdownBody';
import { getCurrentMember } from '@/lib/auth';
import { getPost } from '@/lib/db';

export default async function Page({ params }: { params: Promise<{ pid: string }> }) {
  const member = await getCurrentMember();
  if (!member) redirect('/login');
  const { pid } = await params;
  const post = getPost(Number(pid));
  if (!post) notFound();

  return (
    <AppShell member={member}>
      <section className="page-head">
        <div>
          <p className="eyebrow">Post</p>
          <h1>{String(post.author_name ?? '')}의 진행 공유</h1>
          <p>{String(post.created_at ?? '').slice(0, 10)}{post.project_title ? ` · ${String(post.project_title)}` : ''}</p>
        </div>
      </section>
      <article className="feed-card">
        {post.did ? <section><h2>한 일</h2><MarkdownBody body={String(post.did)} /></section> : null}
        {post.learned ? <section><h2>배운 것</h2><MarkdownBody body={String(post.learned)} /></section> : null}
        {post.blocked ? <section><h2>막힌 점</h2><MarkdownBody body={String(post.blocked)} /></section> : null}
        {post.tags ? <p className="card-meta">태그 {String(post.tags)}</p> : null}
      </article>
    </AppShell>
  );
}
