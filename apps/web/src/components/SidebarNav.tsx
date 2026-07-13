'use client';

import { usePathname } from 'next/navigation';
import { LogoutButton } from './LogoutButton';
import type { MemberPublic } from '@/lib/types';

const feedItems = [
  ['/', '전체 피드', 'home'],
  ['/projects', '프로젝트', 'projects'],
  ['/materials', '자료실', 'materials'],
  ['/questions', '막힌 질문', 'questions'],
  ['/ask', '문의/FAQ', 'ask'],
  ['/members', '멤버', 'members'],
  ['/search', '검색', 'search'],
] as const;

const accountItems = [
  ['/account?goodbai=1', 'Goodbai API', 'developer'],
  ['/account', '비밀번호 변경', 'account'],
] as const;

function isActive(pathname: string, href: string, key: string) {
  if (key === 'home') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ member }: { member: MemberPublic }) {
  const pathname = usePathname();
  const isPI = member.role === 'pi' || member.role === 'professor';

  return (
    <aside className="side" aria-label="BAI Feed navigation">
      <div className="brand">BAI <span className="b">Feed</span></div>
      <div className="navsec">피드</div>
      {feedItems.map(([href, label, key]) => (
        <a key={key} href={href} data-view={key} className={isActive(pathname, href, key) ? 'on' : ''}>
          {label}
        </a>
      ))}
      <div className="navsec">계정</div>
      {accountItems.map(([href, label, key]) => (
        <a key={key} href={href} data-view={key} className={isActive(pathname, href.split('?')[0], key) ? 'on' : ''}>
          {label}
        </a>
      ))}
      {isPI ? <a href="/admin/members" data-view="admin" className={isActive(pathname, '/admin/members', 'admin') ? 'on' : ''}>멤버 관리</a> : null}
      {isPI ? (
        <>
          <div className="navsec">이동</div>
          <a href="/cockpit" data-view="cockpit" className={pathname.startsWith('/cockpit') ? 'on' : ''}>HAI OS</a>
          <a href="http://100.96.96.101:8003/" target="_blank" rel="noopener noreferrer">Professor OS</a>
        </>
      ) : null}
      <div className="who">{member.name}</div>
      <LogoutButton />
    </aside>
  );
}
