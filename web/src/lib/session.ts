import { ApiError } from '../api/client.js';

/** §8.10 "Session expired": any 401 UNAUTHORIZED outside the auth screens
 * means the session ended — drop the cache and send the user to login. */
export function shouldRedirectToLogin(error: unknown, pathname: string): boolean {
  return (
    error instanceof ApiError &&
    error.status === 401 &&
    error.code === 'UNAUTHORIZED' &&
    pathname !== '/login' &&
    pathname !== '/welcome'
  );
}
