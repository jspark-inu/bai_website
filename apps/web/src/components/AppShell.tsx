import { SidebarNav } from './SidebarNav';
import type { MemberPublic } from '@/lib/types';

export function AppShell({ member, children }: { member: MemberPublic | null; children: React.ReactNode }) {
  if (!member) {
    return <main className="container" id="view">{children}</main>;
  }

  return (
    <>
      <SidebarNav member={member} />
      <main className="container" id="view">{children}</main>
    </>
  );
}
