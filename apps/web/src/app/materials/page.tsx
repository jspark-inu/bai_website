import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { MaterialResourceCard } from '@/components/MaterialResourceCard';
import { MaterialUploadForm } from '@/components/MaterialUploadForm';
import { getCurrentMember } from '@/lib/auth';
import { listMaterials } from '@/lib/db';

export default async function Page() {
  const member = await getCurrentMember();
  if (!member) redirect('/login');
  const materials = listMaterials();

  return (
    <AppShell member={member}>
      <section className="page-head">
        <div>
          <p className="eyebrow">Resources</p>
          <h1>자료실</h1>
          <p>온보딩, 길드별 활동 자료, 발표 파일을 한 곳에 모읍니다.</p>
        </div>
      </section>
      <MaterialUploadForm />
      <section className="resource-grid">
        {materials.length ? materials.map((material) => (
          <MaterialResourceCard key={material.id} material={material} member={member} />
        )) : <div className="empty-state">아직 올라온 자료가 없습니다.</div>}
      </section>
    </AppShell>
  );
}
