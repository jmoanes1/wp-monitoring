import { useState } from 'react';
import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useData } from '../context/DataContext.jsx';
import { api } from '../services/api.js';
import { notificationEmoji } from '../utils/notificationCopy.js';
import { formatDateTime } from '../utils/time.js';

export default function NotificationBell() {
  const { notifications, stats } = useData();
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((item) => !item.read).slice(0, 6);

  async function markAll() {
    await api('/notifications/read-all', { method: 'PUT' });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <Bell size={18} />
        {stats.unreadNotifications > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
            {stats.unreadNotifications}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-ink-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <p className="text-sm font-semibold">Notifications</p>
            <button type="button" onClick={markAll} className="text-xs text-teal-700 dark:text-teal-400">
              Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {unread.length === 0 && <p className="px-4 py-6 text-sm text-slate-500">No unread alerts.</p>}
            {unread.map((item) => (
              <Link
                key={item.id}
                to="/notifications"
                onClick={() => setOpen(false)}
                className="block border-b border-slate-100 px-4 py-3 last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-white/5"
              >
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {notificationEmoji(item)} {item.title}
                  {item.criticalAlert ? ' · Critical' : ''}
                </p>
                <p className="mt-1 text-xs text-slate-500">{item.message}</p>
                <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(item.createdAt).label}</p>
              </Link>
            ))}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block px-4 py-3 text-center text-sm text-teal-700 dark:text-teal-400">
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
