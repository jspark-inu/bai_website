'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LoginForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password }),
    });
    if (response.ok) {
      router.push('/materials');
      router.refresh();
      return;
    }
    setError('이름 또는 비밀번호가 맞지 않습니다.');
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>이름<input className="input" value={name} onChange={(event) => setName(event.target.value)} autoComplete="username" /></label>
      <label>비밀번호<input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
      {error ? <p className="error">{error}</p> : null}
      <button className="button" type="submit">로그인</button>
    </form>
  );
}
