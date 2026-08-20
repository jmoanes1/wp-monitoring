import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../context/DataContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { formatDateTime } from '../utils/time.js';

const FILTERS = [
  { id: 'pending', label: 'Pending' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'all', label: 'All' }
];

export default function Updates() {
  const { updates, websites } = useData();
  const [status, setStatus] = useState('pending');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    return updates.filter((item) => {
      const site = websites.find((siteItem) => siteItem.id === item.websiteId);
      if (status !== 'all' && item.status !== status) return false;
      const haystack = `${item.name} ${item.type} ${site?.name || ''}`.toLowerCase();
      return !query || haystack.includes(query.toLowerCase());
    });
  }, [updates, websites, status, query]);

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
                onClick={() => setStatus(item.id)}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  status === item.id
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
          {filtered.length} of {updates.length}
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-ink-900">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs text-slate-400 dark:border-slate-800">
              <th className="px-4 py-2.5 font-medium">Update</th>
              <th className="px-4 py-2.5 font-medium">Website</th>
              <th className="px-4 py-2.5 font-medium">Current</th>
              <th className="px-4 py-2.5 font-medium">Available</th>
              <th className="px-4 py-2.5 font-medium">Detected</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const site = websites.find((siteItem) => siteItem.id === item.websiteId);
              return (
                <tr key={item.id} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/70 dark:border-slate-800 dark:hover:bg-white/5">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{item.name}</p>
                    <p className="text-xs capitalize text-slate-400">{item.type}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/websites/${item.websiteId}`} className="text-slate-700 hover:text-teal-700 dark:text-slate-300 dark:hover:text-teal-400">
                      {site?.name || 'Website'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-500">{item.currentVersion || '—'}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{item.availableVersion || '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {formatDateTime(item.detectedAt).label}
                    {item.resolvedAt && (
                      <p className="text-emerald-600">Resolved {formatDateTime(item.resolvedAt).label}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge compact status={item.status === 'pending' ? 'warning' : 'resolved'} />
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan="6" className="px-4 py-12 text-center text-sm text-slate-400">
                  No updates match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
