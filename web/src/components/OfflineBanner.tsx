import { useEffect, useState, useSyncExternalStore } from 'react';
import { getQueueCount, QUEUE_DROPPED_EVENT, subscribeQueueCount } from '../lib/offline.js';

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/** §8.7 offline state: thin top banner while offline, with the queue count
 * when mutations are waiting; surfaces "Updated elsewhere" for a few
 * seconds when a replayed mutation loses a last-write-wins race (§4.7). */
export function OfflineBanner(): React.JSX.Element | null {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const queued = useSyncExternalStore(subscribeQueueCount, getQueueCount, () => 0);
  const [dropped, setDropped] = useState(false);

  useEffect(() => {
    const onDropped = (): void => setDropped(true);
    window.addEventListener(QUEUE_DROPPED_EVENT, onDropped);
    return () => window.removeEventListener(QUEUE_DROPPED_EVENT, onDropped);
  }, []);

  useEffect(() => {
    if (!dropped) return;
    const timer = window.setTimeout(() => setDropped(false), 4000);
    return () => window.clearTimeout(timer);
  }, [dropped]);

  if (dropped) {
    return (
      <div role="alert" className="bg-surface px-4 py-1.5 text-center text-muted">
        Updated elsewhere.
      </div>
    );
  }
  if (!online) {
    return (
      <div role="status" className="bg-surface px-4 py-1.5 text-center text-muted">
        Offline — changes will sync when you reconnect.
        {queued > 0 && <span className="ml-2">{queued} change(s) waiting to sync</span>}
      </div>
    );
  }
  return null;
}
