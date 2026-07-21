import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearSessionCookie: vi.fn(),
  proxyLegacyApi: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ clearSessionCookie: mocks.clearSessionCookie }));
vi.mock('@/lib/legacy-api-proxy', () => ({ proxyLegacyApi: mocks.proxyLegacyApi }));

import { POST as authLogin } from '@/app/api/auth/login/route';
import { POST as authLogout } from '@/app/api/auth/logout/route';
import { GET as authMe } from '@/app/api/auth/me/route';
import { GET as meGet, POST as mePost } from '@/app/api/me/route';
import { GET as talentList, POST as talentCreate } from '@/app/api/talent-office/route';
import { GET as talentDetail } from '@/app/api/talent-office/[rid]/route';
import { POST as talentReview } from '@/app/api/talent-office/[rid]/review/route';
import { POST as talentAssign } from '@/app/api/talent-office/[rid]/assignees/route';
import { POST as talentSolution } from '@/app/api/talent-office/[rid]/solution/route';
import { POST as talentDecision } from '@/app/api/talent-office/[rid]/decision/route';
import { GET as talentPoints } from '@/app/api/talent-office/points/route';
import { GET as wallList, POST as wallCreate } from '@/app/api/wall/route';

const response = Response.json({ ok: true });
const request = (path: string, method = 'GET') => new Request(`http://next.test${path}`, { method });
const talentContext = { params: Promise.resolve({ rid: '17' }) };

describe('legacy-backed auth and talent API routes', () => {
  beforeEach(() => {
    mocks.clearSessionCookie.mockReset().mockResolvedValue(undefined);
    mocks.proxyLegacyApi.mockReset().mockResolvedValue(response.clone());
  });

  it('delegates login to Flask and removes any stale Next session', async () => {
    const req = request('/api/auth/login', 'POST');
    await authLogin(req as never);
    expect(mocks.clearSessionCookie).toHaveBeenCalledOnce();
    expect(mocks.proxyLegacyApi).toHaveBeenCalledWith(req, 'login');
  });

  it('delegates logout to Flask and clears the Next session', async () => {
    const req = request('/api/auth/logout', 'POST');
    const result = await authLogout(req);
    expect(mocks.proxyLegacyApi).toHaveBeenCalledWith(req, 'logout');
    expect(mocks.clearSessionCookie).toHaveBeenCalledOnce();
    expect(result.status).toBe(200);
  });

  it('uses Flask as the sole current-member API contract', async () => {
    const authReq = request('/api/auth/me');
    const getReq = request('/api/me?api_key=1');
    const postReq = request('/api/me', 'POST');
    await authMe(authReq);
    await meGet(getReq);
    await mePost(postReq);
    expect(mocks.proxyLegacyApi).toHaveBeenNthCalledWith(1, authReq, 'me');
    expect(mocks.proxyLegacyApi).toHaveBeenNthCalledWith(2, getReq, 'me');
    expect(mocks.proxyLegacyApi).toHaveBeenNthCalledWith(3, postReq, 'me');
  });

  it('keeps anonymous wall writes on the Flask database writer', async () => {
    const listReq = request('/api/wall?limit=8');
    const createReq = request('/api/wall', 'POST');
    await wallList(listReq);
    await wallCreate(createReq);
    expect(mocks.proxyLegacyApi.mock.calls).toEqual([
      [listReq, 'wall'],
      [createReq, 'wall'],
    ]);
  });

  it('maps every standard talent operation to its Flask endpoint', async () => {
    const listReq = request('/api/talent-office');
    const createReq = request('/api/talent-office', 'POST');
    const detailReq = request('/api/talent-office/17');
    const reviewReq = request('/api/talent-office/17/review', 'POST');
    const assignReq = request('/api/talent-office/17/assignees', 'POST');
    const solutionReq = request('/api/talent-office/17/solution', 'POST');
    const decisionReq = request('/api/talent-office/17/decision', 'POST');
    const pointsReq = request('/api/talent-office/points');

    await talentList(listReq);
    await talentCreate(createReq);
    await talentDetail(detailReq, talentContext);
    await talentReview(reviewReq, talentContext);
    await talentAssign(assignReq, talentContext);
    await talentSolution(solutionReq, talentContext);
    await talentDecision(decisionReq, talentContext);
    await talentPoints(pointsReq);

    expect(mocks.proxyLegacyApi.mock.calls).toEqual([
      [listReq, 'talent-office'],
      [createReq, 'talent-office'],
      [detailReq, ['talent-office', '17']],
      [reviewReq, ['talent-office', '17', 'review']],
      [assignReq, ['talent-office', '17', 'assignees']],
      [solutionReq, ['talent-office', '17', 'solution']],
      [decisionReq, ['talent-office', '17', 'decision']],
      [pointsReq, ['talent-office', 'points']],
    ]);
  });
});
