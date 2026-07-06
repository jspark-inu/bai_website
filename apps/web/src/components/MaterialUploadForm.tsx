'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function MaterialUploadForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!String(data.get('title') ?? '').trim()) {
      setBusy(false);
      setError('제목을 입력해야 합니다.');
      return;
    }
    if (!String(data.get('url') ?? '').trim() && !String(data.get('body') ?? '').trim() && !(data.get('file') as File)?.size) {
      setBusy(false);
      setError('파일, 링크, 본문 중 하나 이상을 입력해야 합니다.');
      return;
    }
    const response = await fetch('/api/materials', { method: 'POST', body: data });
    setBusy(false);
    if (!response.ok) {
      setError('저장 실패. 입력값을 확인해 주세요.');
      return;
    }
    form.reset();
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <div className="toolbar">
        <button className="primary-action" type="button" onClick={() => setOpen(true)}>
          자료 올리기
        </button>
      </div>
    );
  }

  return (
    <form className="resource-form" onSubmit={submit}>
      <div className="editor-head">
        <b>자료 올리기</b>
        <span>파일, 링크, 본문 중 하나 이상을 올릴 수 있습니다.</span>
      </div>
      <div className="form-grid">
        <label>제목<input name="title" placeholder="예: BAI 첫 참여 안내" /></label>
        <label>분류<select name="category" defaultValue="자료"><option>온보딩</option><option>길드</option><option>공지</option><option>자료</option></select></label>
        <label>길드/대상<input name="guild" placeholder="공통, 웹, AI, 데이터" /></label>
        <label>파일<input name="file" type="file" /></label>
      </div>
      <label>링크<input name="url" placeholder="https://..." /></label>
      <label>본문<textarea name="body" rows={5} placeholder="요약, 사용법, 준비물 등을 적어주세요." /></label>
      <div className="form-actions">
        <button className="primary-action" type="submit" disabled={busy}>{busy ? '저장 중' : '자료 올리기'}</button>
        <button className="secondary-action" type="button" onClick={() => { setError(''); setOpen(false); }}>취소</button>
        {error ? <p className="err">{error}</p> : null}
      </div>
    </form>
  );
}
