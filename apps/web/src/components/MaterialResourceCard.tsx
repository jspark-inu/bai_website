'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MarkdownBody } from '@/components/MarkdownBody';
import type { Material, MemberPublic } from '@/lib/types';
import { safeMaterialUrl } from '@/lib/url';

function canEditMaterial(material: Material, member: MemberPublic) {
  return member.role === 'pi' || member.role === 'professor' || material.author_id === member.id;
}

export function MaterialResourceCard({ material, member }: { material: Material; member: MemberPublic }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editable = canEditMaterial(material, member);
  const fileHref = safeMaterialUrl(material.file_url);
  const linkHref = safeMaterialUrl(material.url);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    const hasNewFile = (data.get('file') as File | null)?.size;
    if (!String(data.get('title') ?? '').trim()) {
      setBusy(false);
      setError('제목을 입력해야 합니다.');
      return;
    }
    if (!String(data.get('url') ?? '').trim() && !String(data.get('body') ?? '').trim() && !material.file_url && !hasNewFile) {
      setBusy(false);
      setError('파일, 링크, 본문 중 하나 이상이 필요합니다.');
      return;
    }
    const response = await fetch(`/api/materials/${material.id}`, { method: 'POST', body: data });
    setBusy(false);
    if (!response.ok) {
      setError(response.status === 403 ? '수정 권한이 없습니다.' : '수정 실패. 입력값을 확인해 주세요.');
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm('이 자료를 삭제할까요? 삭제 후 되돌릴 수 없습니다.')) return;
    setError('');
    setBusy(true);
    const response = await fetch(`/api/materials/${material.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!response.ok) {
      setError(response.status === 403 ? '삭제 권한이 없습니다.' : '삭제 실패. 다시 시도해 주세요.');
      return;
    }
    router.refresh();
  }

  if (editing) {
    return (
      <article className="resource-card material-edit-card">
        <form className="material-edit-form" onSubmit={submit}>
          <div className="editor-head">
            <b>자료 수정</b>
            <span>새 파일을 선택하면 기존 첨부파일이 교체됩니다.</span>
          </div>
          <div className="form-grid">
            <label>제목<input name="title" defaultValue={material.title} /></label>
            <label>분류<select name="category" defaultValue={material.category || '자료'}><option>온보딩</option><option>길드</option><option>공지</option><option>자료</option></select></label>
            <label>길드/대상<input name="guild" defaultValue={material.guild || ''} /></label>
            <label>파일<input name="file" type="file" /></label>
          </div>
          <label>링크<input name="url" defaultValue={material.url || ''} placeholder="https://..." /></label>
          <label>본문<textarea name="body" rows={5} defaultValue={material.body || ''} /></label>
          <div className="form-actions">
            <button className="primary-action" type="submit" disabled={busy}>{busy ? '저장 중' : '저장'}</button>
            <button className="secondary-action" type="button" onClick={() => { setError(''); setEditing(false); }} disabled={busy}>취소</button>
            {error ? <p className="err">{error}</p> : null}
          </div>
        </form>
      </article>
    );
  }

  return (
    <article className="resource-card">
      <div className="resource-card-top">
        <div className="card-meta">{[material.category, material.guild, material.author_name, material.created_at?.slice(0, 10)].filter(Boolean).join(' · ')}</div>
        {editable ? (
          <div className="resource-actions">
            <button className="secondary-action mini" type="button" onClick={() => setEditing(true)}>수정</button>
            <button className="secondary-action mini danger" type="button" onClick={remove} disabled={busy}>{busy ? '삭제 중' : '삭제'}</button>
          </div>
        ) : null}
      </div>
      <h2>{material.title}</h2>
      <div className="resource-links">
        {fileHref ? <a href={fileHref}>첨부파일: {material.file_name || '다운로드'}</a> : null}
        {linkHref ? <a href={linkHref} target="_blank" rel="noreferrer">링크 열기</a> : null}
      </div>
      {material.body ? <MarkdownBody body={material.body} /> : null}
      {error ? <p className="err">{error}</p> : null}
    </article>
  );
}
