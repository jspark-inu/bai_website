import { requireApiMember } from './auth.ts';
import { exactJsonResponse, privateJsonResponse } from './exact-json-response.ts';
import { readJsonObject, writeResultResponse } from './write-route.ts';
import {
  adminMemberExists, createGoodbaiPost, getAdminMembers, getApiKeyMember, getOwnApiKey,
  regenerateMemberApiKey, regenerateOwnApiKey, updateAdminMember,
} from './services/admin-goodbai.ts';
import { parseFlaskPathInt } from './api-params.ts';

export async function ownApiKeyGET(_request?: Request) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  const payload = getOwnApiKey(auth.member);
  return payload
    ? privateJsonResponse(payload)
    : privateJsonResponse({ error: 'login required' }, { status: 401 });
}

export async function ownApiKeyRegeneratePOST(_request?: Request) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  const apiKey = regenerateOwnApiKey(auth.member);
  return apiKey
    ? privateJsonResponse({ api_key: apiKey })
    : privateJsonResponse({ error: 'login required' }, { status: 401 });
}

async function requirePi() {
  const auth = await requireApiMember();
  if (!auth.ok) return auth;
  if (auth.member.role !== 'pi') {
    return { ok: false as const, error: Response.json({ error: 'pi only' }, { status: 403 }) };
  }
  return auth;
}

export async function adminMembersGET(_request?: Request) {
  const auth = await requirePi();
  if (!auth.ok) return auth.error;
  return exactJsonResponse({ members: getAdminMembers() });
}

export function flaskMethodNotAllowedResponse() {
  return new Response(
    '<!doctype html>\n<html lang=en>\n<title>405 Method Not Allowed</title>\n<h1>Method Not Allowed</h1>\n<p>The method is not allowed for the requested URL.</p>\n',
    { status: 405, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

export async function adminMemberKeyRegeneratePOST(mid: string) {
  const id = parseFlaskPathInt(mid);
  if (id === null) return flaskMethodNotAllowedResponse();
  const auth = await requirePi();
  if (!auth.ok) return auth.error;
  if (!adminMemberExists(id)) return Response.json({ error: 'not found' }, { status: 404 });
  const result = regenerateMemberApiKey(auth.member.id, id);
  return result.ok
    ? privateJsonResponse(result.value)
    : privateJsonResponse({ error: result.error }, { status: result.status });
}

export async function adminMemberPOST(request: Request, mid: string) {
  const id = parseFlaskPathInt(mid);
  if (id === null) return flaskMethodNotAllowedResponse();
  const auth = await requirePi();
  if (!auth.ok) return auth.error;
  // Flask checks target existence before parsing the request body.
  if (!adminMemberExists(id)) return Response.json({ error: 'not found' }, { status: 404 });
  const result = updateAdminMember(auth.member.id, id, await readJsonObject(request));
  return writeResultResponse(result);
}

export async function goodbaiPostPOST(request: Request) {
  const apiKey = request.headers.get('X-API-Key');
  const member = getApiKeyMember(apiKey);
  if (!member) return Response.json({ error: 'invalid api key' }, { status: 401 });
  return writeResultResponse(createGoodbaiPost(member.id, apiKey!, await readJsonObject(request)));
}
