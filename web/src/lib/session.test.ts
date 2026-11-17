import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client.js';
import { shouldRedirectToLogin } from './session.js';

function apiError(status: number, code: 'UNAUTHORIZED' | 'FORBIDDEN'): ApiError {
  return new ApiError(status, { code, message: 'x', requestId: 'r' });
}

describe('shouldRedirectToLogin (§8.10 session expired)', () => {
  it('redirects on 401 UNAUTHORIZED outside the auth screens', () => {
    expect(shouldRedirectToLogin(apiError(401, 'UNAUTHORIZED'), '/')).toBe(true);
    expect(shouldRedirectToLogin(apiError(401, 'UNAUTHORIZED'), '/catalog')).toBe(true);
  });

  it('never redirects from the login or wizard screens', () => {
    expect(shouldRedirectToLogin(apiError(401, 'UNAUTHORIZED'), '/login')).toBe(false);
    expect(shouldRedirectToLogin(apiError(401, 'UNAUTHORIZED'), '/welcome')).toBe(false);
  });

  it('ignores other 401 codes and non-401 errors', () => {
    expect(shouldRedirectToLogin(apiError(401, 'FORBIDDEN'), '/')).toBe(false);
    expect(shouldRedirectToLogin(apiError(403, 'UNAUTHORIZED'), '/')).toBe(false);
    expect(shouldRedirectToLogin(new Error('boom'), '/')).toBe(false);
    expect(shouldRedirectToLogin(undefined, '/')).toBe(false);
  });
});
