import { useRef, useState } from 'react';
import type { ImportCommitResponse, ImportPreviewResponse, ImportRowDto } from '@kirana/shared';
import {
  useAdminBackup,
  useBoard,
  useImportCommit,
  useImportPreview,
} from '../api/queries';
import { download } from '../api/client';
import {
  countToImport,
  decisionsForCommit,
  distinctStores,
  initialDecisions,
  withDecision,
  type DecisionMap,
  type RowDecision,
} from '../lib/importRows';

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'preview'; readonly fileName: string; readonly result: ImportPreviewResponse }
  | { readonly kind: 'done'; readonly result: ImportCommitResponse; readonly storeCount: number };

export function Data(): React.JSX.Element {
  const board = useBoard();
  const previewImport = useImportPreview();
  const commitImport = useImportCommit();
  const backup = useAdminBackup();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [decisions, setDecisions] = useState<DecisionMap>(new Map());
  const [banner, setBanner] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);
  const [csvStoreId, setCsvStoreId] = useState<string>('');

  const onPreviewError = (error: unknown): void => {
    setBanner(error instanceof Error ? error.message : 'Could not read the file.');
  };

  const chooseFile = (): void => {
    setBanner(null);
    fileInputRef.current?.click();
  };

  const onFileChosen = (file: File | undefined): void => {
    if (file === undefined) return;
    previewImport.mutate(file, {
      onSuccess: (result) => {
        setDecisions(initialDecisions(result.rows));
        setPhase({ kind: 'preview', fileName: file.name, result });
      },
      onError: onPreviewError,
    });
  };

  const startOver = (): void => {
    if (fileInputRef.current !== null) fileInputRef.current.value = '';
    setPhase({ kind: 'idle' });
    setDecisions(new Map());
    setBanner(null);
  };

  const commit = (): void => {
    if (phase.kind !== 'preview') return;
    const { result } = phase;
    commitImport.mutate(
      { token: result.token, decisions: decisionsForCommit(result.rows, decisions) },
      {
        onSuccess: (result) => {
          setPhase({
            kind: 'done',
            result,
            storeCount: distinctStores(phase.result.rows, decisions),
          });
        },
        onError: onPreviewError,
      },
    );
  };

  const exportJson = async (): Promise<void> => {
    setBanner(null);
    setExporting('json');
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await download('/export?format=json', `kirana-export-${stamp}.json`);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setExporting(null);
    }
  };

  const exportCsv = async (): Promise<void> => {
    if (csvStoreId === '') return;
    setBanner(null);
    setExporting('csv');
    try {
      const store = board.data?.stores.find((s) => s.id === csvStoreId);
      await download(`/export?format=csv&storeId=${csvStoreId}`, `kirana-${store?.name ?? 'store'}.csv`);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setExporting(null);
    }
  };

  const createBackup = (): void => {
    setBanner(null);
    backup.mutate(undefined, { onError: onPreviewError });
  };

  const preview = phase.kind === 'preview' ? phase.result : null;
  const toImport = preview !== null ? countToImport(preview.rows, decisions) : 0;
  const reviewCount =
    preview !== null ? preview.duplicate + preview.conflict : 0;

  const rowSelect = (row: ImportRowDto): React.JSX.Element => {
    const decision = decisions.get(row.line) ?? 'skip';
    const options: ReadonlyArray<{ readonly value: RowDecision; readonly label: string }> =
      row.action === 'merge' && row.targetName !== null
        ? [
            { value: 'merge', label: `Merge into ${row.targetName}` },
            { value: 'create', label: 'Create new' },
            { value: 'skip', label: 'Skip' },
          ]
        : row.action === 'create'
          ? [
              { value: 'create', label: 'Create new' },
              { value: 'skip', label: 'Skip' },
            ]
          : [
              { value: 'skip', label: 'Skip' },
              { value: 'create', label: 'Create new' },
            ];
    return (
      <select
        value={decision}
        aria-label={`Decision for ${row.name}`}
        onChange={(event) => {
          const value = event.target.value as RowDecision;
          setDecisions((prev) => withDecision(prev, row.line, value));
        }}
        className="min-h-11 shrink-0 self-center rounded-chip border border-border bg-surface px-2 text-tab focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  };

  return (
    <div className="p-4">
      <h1 className="text-store font-semibold">Data</h1>

      {banner !== null && (
        <div
          role="alert"
          className="mt-3 flex items-center gap-2 rounded-card border border-danger/40 bg-danger/10 px-3 py-2"
        >
          <p className="flex-1 text-item">{banner}</p>
          <button
            type="button"
            onClick={() => setBanner(null)}
            aria-label="Dismiss message"
            className="flex size-11 items-center justify-center rounded-chip text-muted hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          >
            ✕
          </button>
        </div>
      )}

      <section className="mt-4 rounded-card border border-border bg-surface p-4" aria-label="Import">
        <h2 className="text-store font-semibold">Import</h2>

        {phase.kind === 'idle' && (
          <>
            <p className="mt-1 text-item text-muted">Choose a CSV or an export file to preview.</p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={chooseFile}
                disabled={previewImport.isPending}
                className="min-h-11 rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
              >
                {previewImport.isPending ? 'Reading file…' : 'Choose file…'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json,text/csv,application/json"
                aria-label="Choose a CSV or export file to import"
                className="sr-only"
                onChange={(event) => onFileChosen(event.target.files?.[0])}
              />
            </div>
          </>
        )}

        {phase.kind === 'preview' && preview !== null && (
          <>
            <p className="mt-1 text-tab text-muted">File: {phase.fileName}</p>
            <p className="mt-2 text-item">
              {preview.new} new · {preview.duplicate} duplicates · {preview.conflict} conflicts ·{' '}
              {preview.invalid} invalid
            </p>
            {reviewCount > 0 && (
              <p className="mt-1 text-item">
                {reviewCount} rows look like duplicates. Review them below.
              </p>
            )}
            <ul className="mt-3 flex flex-col">
              {preview.rows.map((row) => (
                <li
                  key={row.line}
                  className="flex items-center gap-2 border-b border-border/60 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-item">{row.name}</p>
                    <p className="truncate text-tab text-muted">
                      {row.store} · {row.category ?? 'Uncategorized'}
                      {row.qty !== null
                        ? ` · ${row.qty}${row.unit !== null ? ` ${row.unit}` : ''}`
                        : ''}
                    </p>
                    {row.action === 'merge' && row.targetName !== null && (
                      <p className="truncate text-tab text-muted">→ {row.targetName}</p>
                    )}
                    {row.action === 'error' && row.message !== null && (
                      <p className="truncate text-tab text-danger">{row.message}</p>
                    )}
                  </div>
                  {row.action !== 'error' && rowSelect(row)}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={commit}
                disabled={toImport === 0 || commitImport.isPending}
                className="min-h-11 flex-1 rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
              >
                {commitImport.isPending
                  ? 'Importing…'
                  : toImport === 0
                    ? 'Nothing to import'
                    : `Import ${toImport} items`}
              </button>
              <button
                type="button"
                onClick={startOver}
                className="min-h-11 rounded-chip border border-border px-4 font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Start over
              </button>
            </div>
          </>
        )}

        {phase.kind === 'done' && (
          <>
            <p className="mt-2 text-item" role="status">
              {phase.result.created + phase.result.merged === 0
                ? 'No rows were imported.'
                : `Imported ${phase.result.created + phase.result.merged} items across ${phase.storeCount} stores.`}
            </p>
            <button
              type="button"
              onClick={startOver}
              className="mt-3 min-h-11 rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Import another file
            </button>
          </>
        )}
      </section>

      <section className="mt-4 rounded-card border border-border bg-surface p-4" aria-label="Export">
        <h2 className="text-store font-semibold">Export</h2>
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void exportJson()}
            disabled={exporting !== null}
            className="min-h-11 rounded-chip border border-border px-4 text-left font-medium hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
          >
            {exporting === 'json' ? 'Exporting…' : 'Export everything (JSON)'}
          </button>
          <div className="flex gap-2">
            <select
              aria-label="Store for CSV export"
              value={csvStoreId}
              onChange={(event) => setCsvStoreId(event.target.value)}
              disabled={board.isPending}
              className="min-h-11 min-w-0 flex-1 rounded-chip border border-border bg-surface px-2 text-item focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
            >
              <option value="">
                {board.isPending ? 'Loading…' : 'Pick a store…'}
              </option>
              {board.data?.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.iconRef ?? ''} {store.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void exportCsv()}
              disabled={exporting !== null || csvStoreId === ''}
              className="min-h-11 shrink-0 rounded-chip border border-border px-4 font-medium hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
            >
              {exporting === 'csv' ? 'Exporting…' : 'Export store CSV'}
            </button>
          </div>
          {board.isError && (
            <p role="alert" className="text-tab text-danger">
              {board.error instanceof Error ? board.error.message : 'Could not load stores.'}
            </p>
          )}
        </div>
      </section>

      <section className="mt-4 rounded-card border border-border bg-surface p-4" aria-label="Backup">
        <h2 className="text-store font-semibold">Backup</h2>
        <p className="mt-1 text-item text-muted">
          A snapshot of the whole database, saved on the host.
        </p>
        <button
          type="button"
          onClick={createBackup}
          disabled={backup.isPending}
          className="mt-3 min-h-11 rounded-chip border border-border px-4 font-medium hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
        >
          {backup.isPending ? 'Backing up…' : 'Create backup'}
        </button>
        {backup.isSuccess && backup.data !== undefined && (
          <p role="status" className="mt-2 text-tab text-muted">
            Backup saved: {backup.data.file}
          </p>
        )}
      </section>
    </div>
  );
}
