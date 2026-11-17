import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { MemberDto } from '@kirana/shared';
import { useAuthMembers, useLogin } from '../api/queries';
import { ApiError } from '../api/client';

/** §8.10: passcode errors and rate limiting surface verbatim from the deck. */
function errorCopy(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'RATE_LIMITED') return 'Too many attempts. Try again in a few minutes.';
    if (error.code === 'NOT_FOUND') return 'Unknown member.';
    if (error.code === 'UNAUTHORIZED') return 'Invalid passcode.';
  }
  return 'Something went wrong. Try again.';
}

/** §7.6 login: passcode → member picker → session cookie. The wizard link
 * covers the fresh-deployment case (no household yet). */
export function Login(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const expired = searchParams.get('expired') === '1';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authMembers = useAuthMembers();
  const login = useLogin();

  const [passcode, setPasscode] = useState('');
  const [roster, setRoster] = useState<readonly MemberDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const verify = (): void => {
    setError(null);
    authMembers.mutate(passcode, {
      onSuccess: (response) => {
        setRoster(response.members);
      },
      onError: (cause) => setError(errorCopy(cause)),
    });
  };

  const signIn = (member: MemberDto): void => {
    setError(null);
    login.mutate(
      { passcode, displayName: member.displayName },
      {
        onSuccess: () => {
          queryClient.clear();
          void navigate('/', { replace: true });
        },
        onError: (cause) => setError(errorCopy(cause)),
      },
    );
  };

  const rosterStep = roster.length > 0;

  return (
    <main className="flex min-h-screen [min-height:100dvh] flex-col items-center justify-center bg-bg px-4 font-sans text-fg">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-store text-2xl font-semibold">Kirana</h1>

        {expired && (
          <p role="alert" className="mt-4 rounded-card border border-border bg-surface px-3 py-2 text-item">
            Your session ended. Enter the passcode to continue.
          </p>
        )}

        {!rosterStep ? (
          <form
            className="mt-6"
            onSubmit={(event) => {
              event.preventDefault();
              verify();
            }}
          >
            <label htmlFor="passcode" className="block text-item font-semibold">
              Passcode
            </label>
            <input
              id="passcode"
              type="password"
              inputMode="text"
              autoComplete="current-password"
              autoFocus
              required
              minLength={4}
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              aria-invalid={error !== null}
              className="mt-2 min-h-11 w-full rounded-chip border border-border bg-surface px-3 text-item focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            {error !== null && (
              <p role="alert" className="mt-2 text-item text-danger">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={authMembers.isPending || passcode.length < 4}
              className="mt-4 min-h-11 w-full rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {authMembers.isPending ? 'Checking…' : 'Unlock'}
            </button>
          </form>
        ) : (
          <div className="mt-6">
            <h2 className="text-item font-semibold">Who's using this?</h2>
            {error !== null && (
              <p role="alert" className="mt-2 text-item text-danger">
                {error}
              </p>
            )}
            <ul className="mt-3 flex flex-col gap-2">
              {roster.map((member) => (
                <li key={member.id}>
                  <button
                    type="button"
                    disabled={login.isPending}
                    onClick={() => signIn(member)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-card border border-border bg-surface px-3 py-2 text-left text-item hover:bg-bg disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-8 items-center justify-center rounded-pill text-tab font-semibold text-white"
                      style={{ backgroundColor: member.color }}
                    >
                      {member.displayName.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex-1">{member.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                setRoster([]);
                setError(null);
              }}
              className="mt-4 min-h-11 w-full rounded-chip border border-border px-4 font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Back
            </button>
          </div>
        )}

        <p className="mt-8 text-center text-muted">
          First time here?{' '}
          <Link to="/welcome" className="font-semibold text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            Set up your household
          </Link>
        </p>
      </div>
    </main>
  );
}
