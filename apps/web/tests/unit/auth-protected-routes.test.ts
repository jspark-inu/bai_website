import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiMember: vi.fn(),
  addMaterial: vi.fn(),
  deleteMaterial: vi.fn(),
  getMaterial: vi.fn(),
  listMaterials: vi.fn(),
  updateMaterial: vi.fn(),
  deleteMaterialUpload: vi.fn(),
  saveMaterialUpload: vi.fn(),
  setTalentOperator: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireApiMember: mocks.requireApiMember }));
vi.mock('@/lib/db', () => ({
  addMaterial: mocks.addMaterial,
  deleteMaterial: mocks.deleteMaterial,
  getMaterial: mocks.getMaterial,
  listMaterials: mocks.listMaterials,
  updateMaterial: mocks.updateMaterial,
}));
vi.mock('@/lib/uploads', () => ({
  MaterialUploadError: class MaterialUploadError extends Error {},
  deleteMaterialUpload: mocks.deleteMaterialUpload,
  materialUploadDir: vi.fn(() => '/tmp/bai-auth-route-test'),
  saveMaterialUpload: mocks.saveMaterialUpload,
}));
vi.mock('@/lib/talent-office', () => ({ setTalentOperator: mocks.setTalentOperator }));
vi.mock('@/lib/talent-office-api', () => ({ talentErrorResponse: vi.fn() }));

import { GET as materialsGet } from '@/app/api/materials/route';
import { POST as materialUpdate } from '@/app/api/materials/[mid]/route';
import { POST as operatorUpdate } from '@/app/api/talent-office/operators/[mid]/route';
import { GET as materialDownload } from '@/app/uploads/materials/[...file]/route';

function unavailable() {
  return {
    ok: false as const,
    error: Response.json(
      { error: 'authentication service unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    ),
  };
}

describe('direct Next APIs preserve authentication dependency failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiMember.mockImplementation(async () => unavailable());
  });

  it('returns 503 from material list and edit routes without touching data', async () => {
    const listResponse = await materialsGet(new Request('http://next.test/api/materials') as never);
    const editResponse = await materialUpdate(
      new Request('http://next.test/api/materials/4', { method: 'POST' }) as never,
      { params: Promise.resolve({ mid: '4' }) },
    );

    expect(listResponse.status).toBe(503);
    expect(editResponse.status).toBe(503);
    expect(mocks.listMaterials).not.toHaveBeenCalled();
    expect(mocks.getMaterial).not.toHaveBeenCalled();
    expect(mocks.updateMaterial).not.toHaveBeenCalled();
  });

  it('returns 503 from protected download and operator routes', async () => {
    const downloadResponse = await materialDownload(
      new Request('http://next.test/uploads/materials/file.pdf'),
      { params: Promise.resolve({ file: ['file.pdf'] }) },
    );
    const operatorResponse = await operatorUpdate(
      new Request('http://next.test/api/talent-office/operators/3', { method: 'POST' }),
      { params: Promise.resolve({ mid: '3' }) },
    );

    expect(downloadResponse.status).toBe(503);
    expect(operatorResponse.status).toBe(503);
    expect(mocks.setTalentOperator).not.toHaveBeenCalled();
  });
});
