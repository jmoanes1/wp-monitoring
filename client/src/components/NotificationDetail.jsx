import StatusBadge from './StatusBadge.jsx';
import { notificationLines, notificationStatus } from '../utils/notificationCopy.js';
import { formatDateTime } from '../utils/time.js';

export default function NotificationDetail({ item, onClose, onRead, onDelete }) {
  if (!item) return null;
  const lines = notificationLines(item);
  const badge = item.criticalAlert ? 'critical' : item.severity || notificationStatus(item);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl dark:bg-ink-900">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{item.title}</h2>
          <StatusBadge compact status={badge} />
        </div>
        <div className="mt-3 space-y-1.5 text-sm text-slate-600">
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">Created {formatDateTime(item.createdAt).label}</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          {!item.read && (
            <button
              type="button"
              onClick={() => onRead(item.id)}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
            >
              Mark as read
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(item.id)}
            className="rounded-lg px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-sm text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
