import { useMemo, useState } from 'react';
import { useData } from '../context/DataContext.jsx';
import { api } from '../services/api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import NotificationDetail from '../components/NotificationDetail.jsx';
import ActionMenu from '../components/ActionMenu.jsx';
import { notificationLines, notificationStatus } from '../utils/notificationCopy.js';
import { formatDateTime } from '../utils/time.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'active', label: 'Active' },
  { id: 'resolved', label: 'Resolved' }
];

export default function Notifications() {
  const { notifications, websites } = useData();
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => {
    return notifications.filter((item) => {
      const status = notificationStatus(item);
      if (filter === 'unread') return !item.read;
      if (filter === 'active' || filter === 'resolved') return status === filter;
      return true;
    });
  }, [notifications, filter]);

  async function markRead(id) {
    await api(`/notifications/${id}/read`, { method: 'PUT' });
  }

  async function markAll() {
    await api('/notifications/read-all', { method: 'PUT' });
  }

  async function remove(id) {
    await api(`/notifications/${id}`, { method: 'DELETE' });
    setSelected(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`rounded-md px-2.5 py-1 text-xs ${
                filter === item.id
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-white/10 dark:hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-slate-400">
            {filtered.length} of {notifications.length}
          </p>
          <button type="button" onClick={markAll} className="text-xs text-slate-500 hover:text-slate-800">
            Mark all read
          </button>
        </div>
      </div>

      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-ink-900">
        {filtered.map((item) => {
          const site = websites.find((siteItem) => siteItem.id === item.websiteId);
          const preview = notificationLines(item)[0] || item.message;
          const badge = item.criticalAlert ? 'critical' : item.severity;
          return (
            <article
              key={item.id}
              className={`flex items-start justify-between gap-3 px-4 py-3 ${item.read ? 'opacity-60' : ''}`}
            >
              <button type="button" onClick={() => setSelected(item)} className="min-w-0 flex-1 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</p>
                  <StatusBadge compact status={badge} />
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">{preview}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {site?.name || 'System'} · {formatDateTime(item.createdAt).label}
                </p>
              </button>
              <ActionMenu
                items={[
                  { label: 'View details', onClick: () => setSelected(item) },
                  !item.read && { label: 'Mark as read', onClick: () => markRead(item.id) },
                  { label: 'Delete', onClick: () => remove(item.id), danger: true }
                ]}
              />
            </article>
          );
        })}
        {filtered.length === 0 && (
          <p className="px-4 py-12 text-center text-sm text-slate-400">No notifications in this view.</p>
        )}
      </div>

      {selected && (
        <NotificationDetail
          item={notifications.find((item) => item.id === selected.id) || selected}
          onClose={() => setSelected(null)}
          onRead={markRead}
          onDelete={remove}
        />
      )}
    </div>
  );
}
