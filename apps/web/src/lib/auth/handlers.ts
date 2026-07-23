import {
  getActiveMemberPassword,
  getMemberByName,
  replaceActiveMemberPassword,
} from '../db/repositories/members.ts';
import { withWriteTransaction } from '../db/transaction.ts';
import { privateJsonResponse } from '../exact-json-response.ts';
import { getOwnApiKey, regenerateOwnApiKey } from '../services/admin-goodbai.ts';
import { readJsonObject } from '../write-route.ts';
import { hashWerkzeugPassword, verifyLoginPassword, verifyWerkzeugPassword } from './password.ts';
import { LoginRateLimiter, loginClientIp, loginRateLimiter } from './rate-limit.ts';
import {
  createMemberSessionIfPasswordCurrent,
  requireApiMember,
  revokeMemberSession,
} from './require-member.ts';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './session.ts';

function anonymousMeResponse() {
  return privateJsonResponse({ error: 'not logged in' }, { status: 401 });
}

type LoginDependencies = {
  limiter: LoginRateLimiter;
  verifyPassword: typeof verifyLoginPassword;
  findMember: typeof getMemberByName;
};

const loginDependencies: LoginDependencies = {
  limiter: loginRateLimiter,
  verifyPassword: verifyLoginPassword,
  findMember: getMemberByName,
};

export async function handleLogin(request: Request, dependencies: LoginDependencies = loginDependencies) {
  const data = await readJsonObject(request);
  const name = typeof data.name === 'string' ? data.name : '';
  const password = typeof data.password === 'string' ? data.password : '';
  const ip = loginClientIp(request);
  const admission = dependencies.limiter.beginAttempt(name, ip);
  if (!admission.allowed) {
    return privateJsonResponse(
      { error: 'too many login failures' },
      { status: 429, headers: { 'Retry-After': String(admission.retryAfterSeconds) } },
    );
  }

  let finished = false;
  try {
    const member = dependencies.findMember(name);
    const valid = await dependencies.verifyPassword(password, member?.password_hash ?? null);
    if (!member || !valid) {
      dependencies.limiter.finishAttempt(admission.ticket, false);
      finished = true;
      return privateJsonResponse({ error: 'invalid credentials' }, { status: 401 });
    }
    if (typeof member.id !== 'number' || !Number.isSafeInteger(member.id)) {
      dependencies.limiter.cancelAttempt(admission.ticket);
      finished = true;
      return privateJsonResponse(
        { error: 'authentication service unavailable' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const previous = await readSessionCookie();
    if (previous) revokeMemberSession(previous);
    const token = createMemberSessionIfPasswordCurrent(member.id, member.password_hash);
    if (!token) {
      dependencies.limiter.finishAttempt(admission.ticket, false);
      finished = true;
      return privateJsonResponse({ error: 'invalid credentials' }, { status: 401 });
    }
    await setSessionCookie(token);
    dependencies.limiter.finishAttempt(admission.ticket, true);
    finished = true;
    return privateJsonResponse({ id: member.id, name: member.name, role: member.role });
  } finally {
    if (!finished) dependencies.limiter.cancelAttempt(admission.ticket);
  }
}

export async function loginPOST(request: Request) {
  return handleLogin(request);
}

export async function logoutPOST(_request?: Request) {
  const token = await readSessionCookie();
  try {
    revokeMemberSession(token);
  } finally {
    await clearSessionCookie();
  }
  return privateJsonResponse({ ok: true });
}

export async function meGET(request: Request) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error.status === 401 ? anonymousMeResponse() : auth.error;
  if (new URL(request.url).searchParams.get('api_key') === '1') {
    const payload = getOwnApiKey(auth.member);
    return payload ? privateJsonResponse({ ...auth.member, ...payload }) : anonymousMeResponse();
  }
  return privateJsonResponse(auth.member);
}

export async function mePOST(request: Request) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error.status === 401 ? anonymousMeResponse() : auth.error;
  const data = await readJsonObject(request);
  if (data.action !== 'regenerate_api_key') {
    return privateJsonResponse({ error: 'unknown action' }, { status: 400 });
  }
  const apiKey = regenerateOwnApiKey(auth.member, 'self_regenerate_api_key');
  return apiKey
    ? privateJsonResponse({ api_key: apiKey, member_id: auth.member.id, name: auth.member.name, role: auth.member.role })
    : anonymousMeResponse();
}

export async function changePasswordPOST(request: Request) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  const data = await readJsonObject(request);
  const currentPassword = typeof data.current_password === 'string' ? data.current_password : '';
  const newPassword = typeof data.new_password === 'string' ? data.new_password : '';
  const currentHash = getActiveMemberPassword(auth.member.id);
  if (!currentHash || !await verifyWerkzeugPassword(currentPassword, currentHash)) {
    return privateJsonResponse({ error: 'current password is incorrect' }, { status: 400 });
  }
  if ([...newPassword].length < 4) {
    return privateJsonResponse({ error: 'new password must be at least 4 characters' }, { status: 400 });
  }

  let replacementHash: string;
  try {
    replacementHash = await hashWerkzeugPassword(newPassword);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return privateJsonResponse({ error: 'new password is too long' }, { status: 400 });
  }
  const result = withWriteTransaction((conn) => replaceActiveMemberPassword(
    conn,
    auth.member.id,
    currentHash,
    replacementHash,
  ));
  if (result === 'inactive') {
    return privateJsonResponse({ error: 'login required' }, { status: 401 });
  }
  if (result === 'changed') {
    return privateJsonResponse({ error: 'current password is incorrect' }, { status: 400 });
  }
  return privateJsonResponse({ ok: true });
}
