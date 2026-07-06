import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { MarkdownBody } from '@/components/MarkdownBody';
import { getCurrentMember } from '@/lib/auth';
import { listPosts } from '@/lib/db';

export default async function Page() {
  const member = await getCurrentMember();
  if (!member) redirect('/login');
  const posts = listPosts();
  const blockedCount = posts.filter((post) => String(post.blocked ?? '').trim()).length;
  const myCount = posts.filter((post) => Number(post.author_id) === member.id).length;
  const activeAuthors = new Set(posts.map((post) => String(post.author_name ?? '')).filter(Boolean)).size;

  return (
    <AppShell member={member}>
      <section className="page-head">
        <div>
          <p className="eyebrow">Feed</p>
          <h1>전체 피드</h1>
          <p>BAI 멤버들의 진행 공유를 React/Next 화면에서 바로 확인합니다.</p>
        </div>
      </section>
      <section className="stat-strip" aria-label="Feed summary">
        <div><span>전체 공유</span><b>{posts.length}</b></div>
        <div><span>내 기록</span><b>{myCount}</b></div>
        <div><span>참여 멤버</span><b>{activeAuthors}</b></div>
        <div><span>열린 질문</span><b>{blockedCount}</b></div>
      </section>
      <section className="feed-board">
        <div className="feed-board-head">
          <span>작성자</span>
          <span>진행 공유</span>
          <span>상태</span>
        </div>
        <div className="stack-list feed-main">
          {posts.length ? posts.map((post) => (
            <article className="feed-row activity-card" key={String(post.id)}>
              <div className="activity-head">
                <div className="avatar-dot">{String(post.author_name ?? '?').slice(0, 1)}</div>
                <div>
                  <div className="activity-title">{String(post.author_name ?? '')}</div>
                  <div className="card-meta">{String(post.created_at ?? '').slice(0, 10)} · 댓글 {String(post.comment_count ?? 0)} · 반응 {String(post.reaction_count ?? 0)}</div>
                </div>
              </div>
              <div className="feed-row-body">
                {post.did ? <div className="feed-section"><span className="section-label">한 일</span><MarkdownBody body={String(post.did)} /></div> : null}
                {post.learned ? <div className="feed-section"><span className="section-label">배운 것</span><MarkdownBody body={String(post.learned)} /></div> : null}
                {post.blocked ? <div className="feed-section blocked-section"><span className="section-label">막힌 점</span><MarkdownBody body={String(post.blocked)} /></div> : null}
              </div>
              <div className="feed-row-status">
                {post.blocked ? <span className="status-pill danger">질문</span> : <span className="status-pill">공유</span>}
                <span>{String(post.comment_count ?? 0)} comments</span>
              </div>
            </article>
          )) : <div className="empty-state">아직 진행 공유가 없습니다.</div>}
        </div>
      </section>
    </AppShell>
  );
}
