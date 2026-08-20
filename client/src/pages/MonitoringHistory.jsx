import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../context/DataContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { formatDateTime } from '../utils/time.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'availability', label: 'Availability' },
  { id: 'incident', label: 'Incidents' },
  { id: 'recovery', label: 'Recovery' },
  { id: 'wordpress', label: 'WordPress' },
  { id: 'plugin', label: 'Plugins' },
  { id: 'theme', label: 'Themes' },
  { id: 'ssl', label: 'SSL' }
];

export default function MonitoringHistory() {
  const { history, websites } = useData();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');

  const filtered = useMemo(() => {
    return history.filter((item) => {
      const site = websites.find((siteItem) => siteItem.id === item.websiteId);
      if (type !== 'all' && item.type !== type) return false;
      if (item.type === 'form') return false;
      const haystack = `${site?.name || ''} ${item.message} ${item.type}`.toLowerCase();
      return !query || haystack.includes(query.toLowerCase());
    });
  }, [history, websites, query, type]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-slate-300 dark:border-slate-700 dark:bg-ink-900 dark:text-slate-100 md:max-w-xs"
          />
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setType(item.id)}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  type === item.id
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-white/10 dark:hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-400">
          {filtered.length} of {history.length}
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-ink-900">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs text-slate-400 dark:border-slate-800">
              <th className="px-4 py-2.5 font-medium">When</th>
              <th className="px-4 py-2.5 font-medium">Website</th>
              <th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 font-medium">Change</th>
              <th className="px-4 py-2.5 font-medium">Message</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const site = websites.find((siteItem) => siteItem.id === item.websiteId);
              return (
                <tr key={item.id} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/70 dark:border-slate-800 dark:hover:bg-white/5">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">
                    {formatDateTime(item.checkedAt).label}
                  </td>
                  <td className="px-4 py-3">
                    {item.websiteId ? (
                      <Link to={`/websites/${item.websiteId}`} className="text-slate-700 hover:text-teal-700 dark:text-slate-300 dark:hover:text-teal-400">
                        {site?.name || item.websiteId}
                      </Link>
                    ) : (
                      site?.name || '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs capitalize text-slate-500">{item.type}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <StatusBadge compact status={item.previousStatus || 'unknown'} />
                      <span className="text-slate-300">→</span>
                      <StatusBadge compact status={item.newStatus} />
                    </div>
                  </td>
                  <td className="max-w-md px-4 py-3 text-slate-600">{item.message}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan="5" className="px-4 py-12 text-center text-sm text-slate-400">
                  No history matches the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
