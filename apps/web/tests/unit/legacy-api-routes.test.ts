import { describe, expect, it } from 'vitest';
import { changePasswordPOST, loginPOST, logoutPOST, meGET, mePOST } from '@/lib/auth/handlers';
import { POST as authLogin } from '@/app/api/auth/login/route';
import { POST as authLogout } from '@/app/api/auth/logout/route';
import { GET as authMe } from '@/app/api/auth/me/route';
import { POST as compatLogin } from '@/app/api/login/route';
import { POST as compatLogout } from '@/app/api/logout/route';
import { GET as compatMeGet, POST as compatMePost } from '@/app/api/me/route';
import { POST as changePassword } from '@/app/api/change-password/route';

describe('explicit Next auth route wiring', () => {
  it('keeps the modern JSON handler direct and gives the compatibility URL a mobile form adapter', () => {
    expect(authLogin).toBe(loginPOST);
    expect(compatLogin).not.toBe(loginPOST);
  });

  it('uses the same logout implementation for modern and compatibility URLs', () => {
    expect(authLogout).toBe(logoutPOST);
    expect(compatLogout).toBe(logoutPOST);
  });

  it('uses the Next current-member implementation without a legacy proxy', () => {
    expect(authMe).toBe(meGET);
    expect(compatMeGet).toBe(meGET);
    expect(compatMePost).toBe(mePOST);
    expect(changePassword).toBe(changePasswordPOST);
  });
});
