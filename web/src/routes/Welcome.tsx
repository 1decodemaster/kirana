import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useCreateHousehold, useCreateStore } from '../api/queries';
import { STORE_EMOJI_PRESETS } from '../components/StoreFormSheet';
import { MEMBER_COLORS } from '../lib/memberColors';
import { cn } from '../lib/utils';

type Step = 'household' | 'passcode' | 'you' | 'seed' | 'store';

const STEP_ORDER: readonly Step[] = ['household', 'passcode', 'you', 'seed', 'store'];

const STEP_TITLES: Readonly<Record<Step, string>> = {
  household: 'Name your household',
  passcode: 'Create a passcode',
  you: 'Your name',
  seed: 'Seed starter categories?',
  store: 'Add your first store',
};

function wizardError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'FORBIDDEN') return 'A household already exists.';
    if (error.code === 'VALIDATION_FAILED') return 'Check the fields and try again.';
  }
  return 'Something went wrong. Try again.';
}

const fieldClass =
  'mt-2 min-h-11 w-full rounded-chip border border-border bg-surface px-3 text-item focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const buttonClass =
  'mt-4 min-h-11 w-full rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const ghostButtonClass =
  'mt-2 min-h-11 w-full rounded-chip border border-border px-4 font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** §8.9 first-run wizard: household → passcode → you → seed? → first store
 * → Home with the `+` coach-mark. The household commit is POST /household
 * (ADR-0005); the first store reuses POST /stores. */
export function Welcome(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createHousehold = useCreateHousehold();
  const createStore = useCreateStore();

  const [step, setStep] = useState<Step>('household');
  const [householdName, setHouseholdName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [color, setColor] = useState<string>(MEMBER_COLORS[0] ?? '#4F46E5');
  const [seed, setSeed] = useState(true);
  const [storeName, setStoreName] = useState('');
  const [storeIcon, setStoreIcon] = useState<string>(STORE_EMOJI_PRESETS[0] ?? '🏬');
  const [error, setError] = useState<string | null>(null);

  const stepIndex = STEP_ORDER.indexOf(step);

  const goNext = (): void => {
    setError(null);
    setStep(STEP_ORDER[stepIndex + 1] ?? 'store');
  };

  const goBack = (): void => {
    setError(null);
    setStep(STEP_ORDER[stepIndex - 1] ?? 'household');
  };

  const finish = (store = storeName): void => {
    setError(null);
    createHousehold.mutate(
      { name: householdName.trim(), passcode, displayName: displayName.trim(), color, seedSampleData: seed },
      {
        onSuccess: () => {
          if (store.trim().length === 0) {
            queryClient.clear();
            void navigate('/', { replace: true });
            return;
          }
          createStore.mutate(
            { name: store.trim(), iconKind: 'emoji', iconRef: storeIcon },
            {
              onSuccess: () => {
                queryClient.clear();
                void navigate('/', { replace: true });
              },
              onError: () => {
                // The household exists; landing on Home is still correct —
                // the first store can be added there (§8.9 step 6).
                queryClient.clear();
                void navigate('/', { replace: true });
              },
            },
          );
        },
        onError: (cause) => setError(wizardError(cause)),
      },
    );
  };

  const passcodeValid = passcode.length >= 4;
  const canFinish = householdName.trim().length > 0 && passcodeValid && displayName.trim().length > 0;

  return (
    <main className="flex min-h-screen [min-height:100dvh] flex-col items-center justify-center bg-bg px-4 font-sans text-fg">
      <div className="w-full max-w-sm">
        <p className="text-center text-muted" aria-hidden="true">
          {STEP_ORDER.map((s, i) => (
            <span
              key={s}
              className={cn('mx-1 inline-block size-2 rounded-pill', i <= stepIndex ? 'bg-accent' : 'bg-border')}
            />
          ))}
        </p>
        <h1 className="mt-3 text-center text-store text-2xl font-semibold">
          {STEP_TITLES[step]}
        </h1>

        {error !== null && (
          <p role="alert" className="mt-4 rounded-card border border-danger/40 bg-danger/10 px-3 py-2 text-item text-danger">
            {error}
          </p>
        )}

        {step === 'household' && (
          <form
            className="mt-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (householdName.trim().length > 0) goNext();
            }}
          >
            <label htmlFor="household-name" className="block text-item font-semibold">
              Household name
            </label>
            <input
              id="household-name"
              autoFocus
              required
              maxLength={60}
              value={householdName}
              onChange={(event) => setHouseholdName(event.target.value)}
              className={fieldClass}
            />
            <button type="submit" className={buttonClass}>
              Next
            </button>
          </form>
        )}

        {step === 'passcode' && (
          <form
            className="mt-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (passcodeValid && passcode === confirm) goNext();
              else setError(passcodeValid ? "Passcodes don't match." : 'Passcodes must be at least 4 characters.');
            }}
          >
            <label htmlFor="wizard-passcode" className="block text-item font-semibold">
              Create a passcode
            </label>
            <input
              id="wizard-passcode"
              type="password"
              autoFocus
              required
              minLength={4}
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              className={fieldClass}
            />
            <label htmlFor="wizard-confirm" className="mt-4 block text-item font-semibold">
              Confirm passcode
            </label>
            <input
              id="wizard-confirm"
              type="password"
              required
              minLength={4}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className={fieldClass}
            />
            <button type="submit" className={buttonClass}>
              Next
            </button>
            <button type="button" onClick={goBack} className={ghostButtonClass}>
              Back
            </button>
          </form>
        )}

        {step === 'you' && (
          <form
            className="mt-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (displayName.trim().length > 0) goNext();
            }}
          >
            <label htmlFor="wizard-name" className="block text-item font-semibold">
              Your name
            </label>
            <input
              id="wizard-name"
              autoFocus
              required
              maxLength={40}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className={fieldClass}
            />
            <fieldset className="mt-4">
              <legend className="text-item font-semibold">Pick a color</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {MEMBER_COLORS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    role="radio"
                    aria-checked={color === swatch}
                    aria-label={`Color ${swatch}`}
                    onClick={() => setColor(swatch)}
                    className={cn(
                      'size-11 rounded-pill border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                      color === swatch ? 'border-fg' : 'border-transparent',
                    )}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </div>
            </fieldset>
            <button type="submit" className={buttonClass}>
              Next
            </button>
            <button type="button" onClick={goBack} className={ghostButtonClass}>
              Back
            </button>
          </form>
        )}

        {step === 'seed' && (
          <form
            className="mt-6"
            onSubmit={(event) => {
              event.preventDefault();
              goNext();
            }}
          >
            <label className="flex min-h-11 items-center gap-3 rounded-card border border-border bg-surface px-3">
              <input
                type="checkbox"
                checked={seed}
                onChange={(event) => setSeed(event.target.checked)}
                className="size-5 accent-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
              <span className="text-item">
                Seed starter categories
                <span className="block text-muted">
                  Adds the default categories and 40 sample catalog items.
                </span>
              </span>
            </label>
            <button type="submit" className={buttonClass}>
              Next
            </button>
            <button type="button" onClick={goBack} className={ghostButtonClass}>
              Back
            </button>
          </form>
        )}

        {step === 'store' && (
          <form
            className="mt-6"
            onSubmit={(event) => {
              event.preventDefault();
              finish();
            }}
          >
            <label htmlFor="wizard-store" className="block text-item font-semibold">
              Store name
            </label>
            <input
              id="wizard-store"
              autoFocus
              maxLength={60}
              value={storeName}
              onChange={(event) => setStoreName(event.target.value)}
              className={fieldClass}
            />
            <fieldset className="mt-4">
              <legend className="text-item font-semibold">Icon</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {STORE_EMOJI_PRESETS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    role="radio"
                    aria-checked={storeIcon === emoji}
                    aria-label={`Icon ${emoji}`}
                    onClick={() => setStoreIcon(emoji)}
                    className={cn(
                      'flex size-11 items-center justify-center rounded-pill border-2 text-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                      storeIcon === emoji ? 'border-accent' : 'border-border',
                    )}
                  >
                    <span aria-hidden="true">{emoji}</span>
                  </button>
                ))}
              </div>
              <label htmlFor="wizard-store-icon" className="mt-3 block text-muted">
                Or any emoji
              </label>
              <input
                id="wizard-store-icon"
                maxLength={8}
                value={storeIcon}
                onChange={(event) => setStoreIcon(event.target.value)}
                className={fieldClass}
              />
            </fieldset>
            <button type="submit" disabled={!canFinish || createHousehold.isPending} className={buttonClass}>
              {createHousehold.isPending ? 'Setting up…' : 'Finish'}
            </button>
            <button type="button" onClick={goBack} className={ghostButtonClass}>
              Back
            </button>
            <button
              type="button"
              onClick={() => finish('')}
              disabled={!canFinish || createHousehold.isPending}
              className={ghostButtonClass}
            >
              Skip for now
            </button>
          </form>
        )}

        <p className="mt-8 text-center text-muted">
          Already set up?{' '}
          <Link to="/login" className="font-semibold text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
