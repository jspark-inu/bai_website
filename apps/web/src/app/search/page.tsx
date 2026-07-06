import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { MarkdownBody } from '@/components/MarkdownBody';
import { getCurrentMember } from '@/lib/auth';
import { searchPosts } from '@/lib/db';

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const member = await getCurrentMember();
  if (!member) redirect('/login');
  const params = await searchParams;
  const query = (params.q ?? '').trim();
  const posts = query ? searchPosts(query) : [];

  return (
    <AppShell member={member}>
      <section className="page-head">
        <div>
          <p className="eyebrow">Search</p>
          <h1>검색</h1>
          <p>진행 공유의 본문과 태그를 검색합니다.</p>
        </div>
      </section>
      <form className="search-form" action="/search">
        <input name="q" defaultValue={query} placeholder="검색어" />
        <button className="primary-action" type="submit">검색</button>
      </form>
      <section className="stack-list">
        {query && posts.length ? posts.map((post) => (
          <article className="feed-card" key={String(post.id)}>
            <div className="card-meta">{String(post.author_name ?? '')} · {String(post.created_at ?? '').slice(0, 10)}</div>
            {post.did ? <MarkdownBody body={String(post.did)} /> : null}
            {post.learned ? <MarkdownBody body={String(post.learned)} /> : null}
            {post.blocked ? <MarkdownBody body={String(post.blocked)} /> : null}
          </article>
        )) : <div className="empty-state">{query ? '검색 결과가 없습니다.' : '검색어를 입력하세요.'}</div>}
      </section>
    </AppShell>
  );
}
