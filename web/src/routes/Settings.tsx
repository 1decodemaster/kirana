import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { MemberDto } from '@kirana/shared';
import { useBoard, useCreateMember, useDeleteMember, useHealth, useLogout, usePatchHousehold, useUpdateMember } from '../api/queries';
import { ApiError } from '../api/client';
import { ConfirmSheet, Sheet } from '../components/Sheet';
import { MEMBER_COLORS } from '../lib/memberColors';
import { applyThemePreference, loadThemePreference, saveThemePreference, type ThemePreference } from '../lib/theme';
import { cn } from '../lib/utils';

type SheetKind =
  | { readonly kind: 'household-name' }
  | { readonly kind: 'passcode' }
  | { readonly kind: 'member-add' }
  | { readonly kind: 'member-edit'; readonly member: MemberDto }
  | { readonly kind: 'member-remove'; readonly member: MemberDto }
  | null;

const fieldClass =
  'mt-2 min-h-11 w-full rounded-chip border border-border bg-surface px-3 text-item focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const primaryButtonClass =
  'mt-4 min-h-11 w-full rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const rowClass =
  'flex min-h-11 w-full items-center justify-between rounded-chip px-3 text-left text-item hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent';

const THEME_OPTIONS: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function MemberAvatar({ member }: { readonly member: MemberDto }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 items-center justify-center rounded-pill text-tab font-semibold text-white"
      style={{ backgroundColor: member.color }}
    >
      {member.displayName.charAt(0).toUpperCase()}
    </span>
  );
}

/** §8.1 /settings: household, members, passcode, theme, about. */
export function Settings(): React.JSX.Element {
  const navigate = useNavigate();
  const board = useBoard();
  const health = useHealth();
  const patchHousehold = usePatchHousehold();
  const createMember = useCreateMember();
  const updateMember = useUpdateMember();
  const deleteMember = useDeleteMember();
  const logout = useLogout();

  const [sheet, setSheet] = useState<SheetKind>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [passcodeInput, setPasscodeInput] = useState('');
  const [confirmInput, setConfirmInput] = useState('');
  const [memberNameInput, setMemberNameInput] = useState('');
  const [memberColorInput, setMemberColorInput] = useState<string>(MEMBER_COLORS[0] ?? '#4F46E5');
  const [theme, setTheme] = useState<ThemePreference>('system');

  useEffect(() => {
    setTheme(loadThemePreference(window.localStorage));
  }, []);

  const onThemeChange = (preference: ThemePreference): void => {
    setTheme(preference);
    saveThemePreference(window.localStorage, preference);
    applyThemePreference(preference, document.documentElement);
  };

  const onError = (cause: unknown): void => {
    const message = cause instanceof Error ? cause.message : 'Something went wrong. Try again.';
    if (cause instanceof ApiError && (cause.code === 'VALIDATION_FAILED' || cause.code === 'FORBIDDEN')) {
      // Field-level problems stay inline in the open sheet.
      setFormError(message);
      return;
    }
    setSheet(null);
    setBanner(message);
  };

  if (board.isPending) {
    return (
      <div className="p-4">
        <h1 className="text-store font-semibold">Settings</h1>
        <div className="mt-4 flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-card bg-border/60" />
          ))}
        </div>
      </div>
    );
  }

  if (board.isError || board.data === undefined) {
    return (
      <div className="p-4">
        <h1 className="text-store font-semibold">Settings</h1>
        <div role="alert" className="mt-4 rounded-card border border-border bg-surface p-4">
          <p className="text-item">
            {board.error instanceof Error ? board.error.message : 'Could not load settings.'}
          </p>
          <button
            type="button"
            onClick={() => void board.refetch()}
            className="mt-3 min-h-11 rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const household = board.data.household;
  const members = board.data.members;
  const openSheet = (kind: Exclude<SheetKind, null>): void => {
    setFormError(null);
    if (kind.kind === 'household-name') setNameInput(household.name);
    if (kind.kind === 'passcode') {
      setPasscodeInput('');
      setConfirmInput('');
    }
    if (kind.kind === 'member-add') {
      setMemberNameInput('');
      setMemberColorInput(MEMBER_COLORS[0] ?? '#4F46E5');
    }
    if (kind.kind === 'member-edit') {
      setMemberNameInput(kind.member.displayName);
      setMemberColorInput(kind.member.color);
    }
    setSheet(kind);
  };

  return (
    <div className="p-4">
      <h1 className="text-store font-semibold">Settings</h1>

      {banner !== null && (
        <div
          role="alert"
          className="mt-3 flex items-center gap-2 rounded-card border border-danger/40 bg-danger/10 px-3 py-2"
        >
          <p className="flex-1 text-item">{banner}</p>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setBanner(null)}
            className="flex size-11 items-center justify-center rounded-chip text-muted hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}

      <section className="mt-4 rounded-card border border-border bg-surface p-2" aria-labelledby="settings-household">
        <h2 id="settings-household" className="px-3 pt-2 text-muted">
          Household
        </h2>
        <button type="button" className={rowClass} onClick={() => openSheet({ kind: 'household-name' })}>
          <span>Name</span>
          <span className="text-muted">{household.name}</span>
        </button>
        <button type="button" className={rowClass} onClick={() => openSheet({ kind: 'passcode' })}>
          <span>Passcode</span>
          <span className="text-muted">Change passcode</span>
        </button>
      </section>

      <section className="mt-4 rounded-card border border-border bg-surface p-2" aria-labelledby="settings-members">
        <h2 id="settings-members" className="px-3 pt-2 text-muted">
          Members
        </h2>
        <ul>
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-1">
              <button
                type="button"
                className={cn(rowClass, 'flex-1')}
                onClick={() => openSheet({ kind: 'member-edit', member })}
              >
                <span className="flex items-center gap-3">
                  <MemberAvatar member={member} />
                  {member.displayName}
                </span>
                <span className="text-muted">Edit</span>
              </button>
              <button
                type="button"
                aria-label={`Remove ${member.displayName}`}
                disabled={members.length <= 1}
                onClick={() => openSheet({ kind: 'member-remove', member })}
                className="flex size-11 items-center justify-center rounded-chip text-muted hover:bg-bg disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="p-1">
          <button
            type="button"
            onClick={() => openSheet({ kind: 'member-add' })}
            className="min-h-11 w-full rounded-chip border border-border px-4 font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Add member
          </button>
        </div>
      </section>

      <section className="mt-4 rounded-card border border-border bg-surface p-2" aria-labelledby="settings-theme">
        <h2 id="settings-theme" className="px-3 pt-2 text-muted">
          Theme
        </h2>
        <fieldset className="px-1 pb-1">
          <legend className="sr-only">Theme</legend>
          <div className="flex gap-2">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={theme === option.value}
                onClick={() => onThemeChange(option.value)}
                className={cn(
                  'min-h-11 flex-1 rounded-chip border px-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  theme === option.value ? 'border-accent bg-accent/10 text-accent' : 'border-border hover:bg-bg',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="mt-4 rounded-card border border-border bg-surface p-4" aria-labelledby="settings-about">
        <h2 id="settings-about" className="text-muted">
          About
        </h2>
        <p className="mt-1 text-item">
          Kirana {health.data?.version ?? ''} ({health.data?.revision ?? '…'})
        </p>
      </section>

      <button
        type="button"
        onClick={() =>
          logout.mutate(undefined, {
            onSuccess: () => {
              void navigate('/login', { replace: true });
            },
            onError,
          })
        }
        className="mt-4 min-h-11 w-full rounded-chip border border-danger/40 px-4 font-semibold text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Sign out
      </button>

      {/* ── Sheets ─────────────────────────────────────────────────────── */}

      <Sheet
        open={sheet?.kind === 'household-name'}
        onClose={() => setSheet(null)}
        title="Household name"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            patchHousehold.mutate(
              { name: nameInput.trim() },
              {
                onSuccess: () => setSheet(null),
                onError,
              },
            );
          }}
        >
          <label htmlFor="settings-household-name" className="block text-item font-semibold">
            Name
          </label>
          <input
            id="settings-household-name"
            autoFocus
            required
            maxLength={60}
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
            className={fieldClass}
          />
          {formError !== null && (
            <p role="alert" className="mt-2 text-item text-danger">
              {formError}
            </p>
          )}
          <button type="submit" disabled={patchHousehold.isPending} className={primaryButtonClass}>
            Save
          </button>
        </form>
      </Sheet>

      <Sheet open={sheet?.kind === 'passcode'} onClose={() => setSheet(null)} title="Change passcode">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (passcodeInput.length < 4) {
              setFormError('Passcodes must be at least 4 characters.');
              return;
            }
            if (passcodeInput !== confirmInput) {
              setFormError("Passcodes don't match.");
              return;
            }
            patchHousehold.mutate(
              { passcode: passcodeInput },
              {
                onSuccess: () => setSheet(null),
                onError,
              },
            );
          }}
        >
          <label htmlFor="settings-passcode" className="block text-item font-semibold">
            New passcode
          </label>
          <input
            id="settings-passcode"
            type="password"
            autoFocus
            required
            minLength={4}
            value={passcodeInput}
            onChange={(event) => setPasscodeInput(event.target.value)}
            className={fieldClass}
          />
          <label htmlFor="settings-passcode-confirm" className="mt-4 block text-item font-semibold">
            Confirm new passcode
          </label>
          <input
            id="settings-passcode-confirm"
            type="password"
            required
            minLength={4}
            value={confirmInput}
            onChange={(event) => setConfirmInput(event.target.value)}
            className={fieldClass}
          />
          {formError !== null && (
            <p role="alert" className="mt-2 text-item text-danger">
              {formError}
            </p>
          )}
          <button type="submit" disabled={patchHousehold.isPending} className={primaryButtonClass}>
            Save
          </button>
        </form>
      </Sheet>

      <Sheet open={sheet?.kind === 'member-add'} onClose={() => setSheet(null)} title="Add member">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            createMember.mutate(
              { displayName: memberNameInput.trim(), color: memberColorInput },
              {
                onSuccess: () => setSheet(null),
                onError,
              },
            );
          }}
        >
          <label htmlFor="settings-member-name" className="block text-item font-semibold">
            Name
          </label>
          <input
            id="settings-member-name"
            autoFocus
            required
            maxLength={40}
            value={memberNameInput}
            onChange={(event) => setMemberNameInput(event.target.value)}
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
                  aria-checked={memberColorInput === swatch}
                  aria-label={`Color ${swatch}`}
                  onClick={() => setMemberColorInput(swatch)}
                  className={cn(
                    'size-11 rounded-pill border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    memberColorInput === swatch ? 'border-fg' : 'border-transparent',
                  )}
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </div>
          </fieldset>
          {formError !== null && (
            <p role="alert" className="mt-2 text-item text-danger">
              {formError}
            </p>
          )}
          <button type="submit" disabled={createMember.isPending} className={primaryButtonClass}>
            Add
          </button>
        </form>
      </Sheet>

      <Sheet
        open={sheet?.kind === 'member-edit'}
        onClose={() => setSheet(null)}
        title="Edit member"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (sheet?.kind !== 'member-edit') return;
            updateMember.mutate(
              { id: sheet.member.id, patch: { displayName: memberNameInput.trim(), color: memberColorInput } },
              {
                onSuccess: () => setSheet(null),
                onError,
              },
            );
          }}
        >
          <label htmlFor="settings-member-edit-name" className="block text-item font-semibold">
            Name
          </label>
          <input
            id="settings-member-edit-name"
            autoFocus
            required
            maxLength={40}
            value={memberNameInput}
            onChange={(event) => setMemberNameInput(event.target.value)}
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
                  aria-checked={memberColorInput === swatch}
                  aria-label={`Color ${swatch}`}
                  onClick={() => setMemberColorInput(swatch)}
                  className={cn(
                    'size-11 rounded-pill border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    memberColorInput === swatch ? 'border-fg' : 'border-transparent',
                  )}
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </div>
          </fieldset>
          {formError !== null && (
            <p role="alert" className="mt-2 text-item text-danger">
              {formError}
            </p>
          )}
          <button type="submit" disabled={updateMember.isPending} className={primaryButtonClass}>
            Save
          </button>
        </form>
      </Sheet>

      <ConfirmSheet
        open={sheet?.kind === 'member-remove'}
        onClose={() => setSheet(null)}
        title="Remove member"
        message={
          sheet?.kind === 'member-remove'
            ? `Remove ${sheet.member.displayName} from the household? Their history stays.`
            : ''
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (sheet?.kind !== 'member-remove') return;
          deleteMember.mutate(sheet.member.id, {
            onSuccess: () => setSheet(null),
            onError,
          });
        }}
      />
    </div>
  );
}
