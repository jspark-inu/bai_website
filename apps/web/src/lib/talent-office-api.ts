import { requireApiMember } from './auth.ts';
import { exactJsonResponse } from './exact-json-response.ts';
import { parseFlaskPathInt, type FlaskInt } from './api-params.ts';
import { readJsonObject } from './write-route.ts';
import {
  assignTalentRequest, createTalentRequest, decideTalentRequest, getTalentRequestDetail,
  getTalentRequestForDecision, isTalentOperatorRole, listTalentPoints, listTalentRequests,
  reviewTalentRequest, submitTalentSolution, talentRequestExists, type TalentResult,
} from './services/talent-office.ts';

function resultResponse<T>(result: TalentResult<T>, status = 200): Response {
  return result.ok
    ? exactJsonResponse(result.value, { status })
    : exactJsonResponse({ error: result.error }, { status: result.status });
}

async function authenticated() {
  return requireApiMember();
}

const METHOD_NOT_ALLOWED = '<!doctype html>\n<html lang=en>\n<title>405 Method Not Allowed</title>\n<h1>Method Not Allowed</h1>\n<p>The method is not allowed for the requested URL.</p>\n';

function methodNotAllowed() {
  return new Response(METHOD_NOT_ALLOWED, {
    status: 405,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function requestId(params: Promise<{ rid: string }>): Promise<FlaskInt | null> {
  const { rid } = await params;
  return parseFlaskPathInt(rid);
}

export async function talentOfficeGET(_request?: Request) {
  const auth = await authenticated();
  return auth.ok ? resultResponse(listTalentRequests(auth.member)) : auth.error;
}

export async function talentOfficePOST(request: Request) {
  const auth = await authenticated();
  if (!auth.ok) return auth.error;
  return resultResponse(createTalentRequest(auth.member, await readJsonObject(request)), 201);
}

export async function talentOfficeDetailGET(_request: Request, context: { params: Promise<{ rid: string }> }) {
  const id = await requestId(context.params);
  if (id === null) return exactJsonResponse({ error: 'not found' }, { status: 404 });
  const auth = await authenticated();
  if (!auth.ok) return auth.error;
  return resultResponse(getTalentRequestDetail(auth.member, id));
}

export async function talentOfficeReviewPOST(request: Request, context: { params: Promise<{ rid: string }> }) {
  const id = await requestId(context.params);
  if (id === null) return methodNotAllowed();
  const auth = await authenticated();
  if (!auth.ok) return auth.error;
  if (!isTalentOperatorRole(auth.member.role)) return exactJsonResponse({ error: 'operator only' }, { status: 403 });
  if (!talentRequestExists(id)) return exactJsonResponse({ error: 'not found' }, { status: 404 });
  return resultResponse(reviewTalentRequest(auth.member, id, await readJsonObject(request)));
}

export async function talentOfficeAssigneesPOST(request: Request, context: { params: Promise<{ rid: string }> }) {
  const id = await requestId(context.params);
  if (id === null) return methodNotAllowed();
  const auth = await authenticated();
  if (!auth.ok) return auth.error;
  if (!isTalentOperatorRole(auth.member.role)) return exactJsonResponse({ error: 'operator only' }, { status: 403 });
  return resultResponse(assignTalentRequest(auth.member, id, await readJsonObject(request)));
}

export async function talentOfficeSolutionPOST(request: Request, context: { params: Promise<{ rid: string }> }) {
  const id = await requestId(context.params);
  if (id === null) return methodNotAllowed();
  const auth = await authenticated();
  if (!auth.ok) return auth.error;
  return resultResponse(submitTalentSolution(auth.member, id, await readJsonObject(request)));
}

function sameId(left: unknown, right: number): boolean {
  return (typeof left === 'number' || typeof left === 'bigint') && BigInt(left) === BigInt(right);
}

export async function talentOfficeDecisionPOST(request: Request, context: { params: Promise<{ rid: string }> }) {
  const id = await requestId(context.params);
  if (id === null) return methodNotAllowed();
  const auth = await authenticated();
  if (!auth.ok) return auth.error;
  const item = getTalentRequestForDecision(id);
  if (!item) return exactJsonResponse({ error: 'not found' }, { status: 404 });
  if (!sameId(item.requester_member_id, auth.member.id) && auth.member.role !== 'pi') {
    return exactJsonResponse({ error: 'requester only' }, { status: 403 });
  }
  return resultResponse(decideTalentRequest(auth.member, id, await readJsonObject(request)));
}

export async function talentOfficePointsGET(_request?: Request) {
  const auth = await authenticated();
  return auth.ok ? resultResponse(listTalentPoints(auth.member)) : auth.error;
}
