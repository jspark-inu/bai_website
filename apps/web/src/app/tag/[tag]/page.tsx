import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { MarkdownBody } from '@/components/MarkdownBody';
import { getCurrentMember } from '@/lib/auth';
import { listPostsByTag } from '@/lib/db';

export default async function Page({ params }: { params: Promise<{ tag: string }> }) {
  const member = await getCurrentMember();
  if (!member) redirect('/login');
  const { tag } = await params;
  const decodedTag = decodeURIComponent(tag);
  const posts = listPostsByTag(decodedTag);

  return (
    <AppShell member={member}>
      <section className="page-head">
        <div>
          <p className="eyebrow">Tag</p>
          <h1>#{decodedTag}</h1>
          <p>같은 태그가 붙은 진행 공유입니다.</p>
        </div>
      </section>
      <section className="stack-list">
        {posts.length ? posts.map((post) => (
          <article className="feed-card" key={String(post.id)}>
            <div className="card-meta">{String(post.author_name ?? '')} · {String(post.created_at ?? '').slice(0, 10)}</div>
            {post.did ? <MarkdownBody body={String(post.did)} /> : null}
            {post.learned ? <MarkdownBody body={String(post.learned)} /> : null}
            {post.blocked ? <MarkdownBody body={String(post.blocked)} /> : null}
          </article>
        )) : <div className="empty-state">이 태그의 글이 없습니다.</div>}
      </section>
    </AppShell>
  );
}
