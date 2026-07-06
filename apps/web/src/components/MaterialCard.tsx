import Link from 'next/link';
import type { Material } from '@/lib/types';
import { safeMaterialUrl } from '@/lib/url';

export function MaterialCard({ material }: { material: Material }) {
  const meta = [material.category, material.guild, material.author_name, material.created_at?.slice(0, 10)].filter(Boolean).join(' · ');
  const href = safeMaterialUrl(material.url);
  const fileHref = safeMaterialUrl(material.file_url);
  return (
    <Link className="card" href={`/materials/${material.id}`} style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
      <h2 style={{ marginTop: 0 }}>{material.title}</h2>
      <p className="meta">{meta}</p>
      {fileHref ? <p className="meta">첨부파일: {material.file_name || '다운로드'}</p> : null}
      {href ? <p className="meta">링크: {href}</p> : null}
      {material.body ? <p>{material.body.slice(0, 160)}{material.body.length > 160 ? '…' : ''}</p> : null}
    </Link>
  );
}
