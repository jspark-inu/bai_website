import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { getCurrentMember } from '@/lib/auth';
import { getStats, listOpenQuestions, listProjects } from '@/lib/db';

export default async function Page() {
  const member = await getCurrentMember();
  if (!member) redirect('/login');
  const stats = getStats();
  const projects = listProjects().slice(0, 6);
  const questions = listOpenQuestions().slice(0, 6);

  return (
    <AppShell member={member}>
      <section className="page-head">
        <div>
          <p className="eyebrow">Cockpit</p>
          <h1>운영 현황</h1>
          <p>게시글, 자료, 프로젝트, 열린 질문을 한 화면에서 점검합니다.</p>
        </div>
      </section>
      <section className="metric-grid">
        <div><b>{stats.posts}</b><span>진행 공유</span></div>
        <div><b>{stats.materials}</b><span>자료</span></div>
        <div><b>{stats.projects}</b><span>프로젝트</span></div>
        <div><b>{stats.blocked}</b><span>열린 질문</span></div>
      </section>
      <section className="split-grid">
        <article className="resource-card">
          <h2>최근 프로젝트</h2>
          {projects.map((project) => <p key={String(project.id)}>{String(project.title ?? '')}</p>)}
        </article>
        <article className="resource-card">
          <h2>열린 질문</h2>
          {questions.map((question) => <p key={String(question.id)}>{String(question.author_name ?? '')} · {String(question.blocked ?? '').slice(0, 80)}</p>)}
        </article>
      </section>
    </AppShell>
  );
}
