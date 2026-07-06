import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { MarkdownBody } from '@/components/MarkdownBody';
import { getCurrentMember } from '@/lib/auth';
import { getMemberById, listPostsByMember } from '@/lib/db';

export default async function Page({ params }: { params: Promise<{ mid: string }> }) {
  const viewer = await getCurrentMember();
  if (!viewer) redirect('/login');
  const { mid } = await params;
  const profile = getMemberById(Number(mid));
  if (!profile) notFound();
  const posts = listPostsByMember(profile.id);

  return (
    <AppShell member={viewer}>
      <section className="page-head">
        <div>
          <p className="eyebrow">Member</p>
          <h1>{profile.name}</h1>
          <p>{profile.role} · 진행 공유 {posts.length}개</p>
        </div>
      </section>
      <section className="stack-list">
        {posts.length ? posts.map((post) => (
          <article className="feed-card" key={String(post.id)}>
            <div className="card-meta">{String(post.created_at ?? '').slice(0, 10)}</div>
            {post.did ? <MarkdownBody body={String(post.did)} /> : null}
            {post.learned ? <MarkdownBody body={String(post.learned)} /> : null}
            {post.blocked ? <MarkdownBody body={String(post.blocked)} /> : null}
          </article>
        )) : <div className="empty-state">아직 공유한 글이 없습니다.</div>}
      </section>
    </AppShell>
  );
}
