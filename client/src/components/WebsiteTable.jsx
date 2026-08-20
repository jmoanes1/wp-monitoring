import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge.jsx';
import ActionMenu from './ActionMenu.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import { formatDateTime } from '../utils/time.js';
import { api } from '../services/api.js';
import { useData } from '../context/DataContext.jsx';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'online', label: 'Online' },
  { id: 'offline', label: 'Offline' },
  { id: 'critical', label: 'Critical' },
  { id: 'updates', label: 'Updates' }
];

export default function WebsiteTable({ websites, onEdit, actions }) {
  const { pushToast } = useData();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [busyId, setBusyId] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    return websites.filter((site) => {
      const haystack = `${site.name} ${site.url}`.toLowerCase();
      if (query && !haystack.includes(query.toLowerCase())) return false;
      if (status === 'online' && site.status !== 'online') return false;
      if (status === 'offline' && site.status !== 'offline') return false;
      if (status === 'updates' && !site.wordpress?.updateAvailable) return false;
      if (status === 'critical' && site.status !== 'offline') return false;
      return true;
    });
  }, [websites, query, status]);

  async function run(action, site) {
    setBusyId(site.id + action);
    try {
      if (action === 'test') await api(`/websites/${site.id}/test`, { method: 'POST' });
      if (action === 'updates') await api(`/websites/${site.id}/check-updates`, { method: 'POST' });
    } catch (error) {
      pushToast({
        tone: 'error',
        persist: true,
        title: 'Action failed',
        body: error.message || 'Please try again.'
      });
    } finally {
      setBusyId('');
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api(`/websites/${pendingDelete.id}`, { method: 'DELETE' });
      pushToast({
        tone: 'success',
        title: `${pendingDelete.name} deleted`
      });
      setPendingDelete(null);
    } catch (error) {
      pushToast({
        tone: 'error',
        persist: true,
        title: 'Could not delete website',
        body: error.message || 'Please try again.'
      });
    } finally {
      setDeleting(false);
    }
  }

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
            {FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setStatus(filter.id)}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  status === filter.id
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-white/10 dark:hover:text-slate-200'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-slate-400">
            {filtered.length} of {websites.length}
          </p>
          {actions}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-ink-900">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs text-slate-400 dark:border-slate-800">
              <th className="px-4 py-2.5 font-medium">Website</th>
              <th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Response</th>
              <th className="px-4 py-2.5 font-medium">Checked</th>
              <th className="px-4 py-2.5 font-medium text-right"> </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((site) => {
              return (
                <tr key={site.id} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/70 dark:border-slate-800 dark:hover:bg-white/5">
                  <td className="px-4 py-3">
                    <Link to={`/websites/${site.id}`} className="font-medium text-slate-900 hover:text-teal-700 dark:text-slate-100 dark:hover:text-teal-400">
                      {site.name}
                    </Link>
                    <p className="text-xs text-slate-400">{displayHost(site.url)}</p>
                  </td>
                  <td className="px-4 py-3 text-xs capitalize text-slate-500">{site.type}</td>
                  <td className="px-4 py-3">
                    <StatusBadge compact status={site.monitoringEnabled === false ? 'disabled' : site.status} />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-500">
                    {site.responseTime ? `${site.responseTime}ms` : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{formatDateTime(site.lastCheckedAt).label}</td>
                  <td className="px-4 py-3 text-right">
                    <ActionMenu
                      items={[
                        onEdit && { label: 'Edit', onClick: () => onEdit(site), disabled: Boolean(busyId) || deleting },
                        {
                          label: busyId === site.id + 'test' ? 'Testing...' : 'Test website',
                          onClick: () => run('test', site),
                          disabled: Boolean(busyId) || deleting
                        },
                        {
                          label: busyId === site.id + 'updates' ? 'Checking...' : 'Check updates',
                          onClick: () => run('updates', site),
                          disabled: Boolean(busyId) || deleting
                        },
                        {
                          label: deleting && pendingDelete?.id === site.id ? 'Deleting...' : 'Delete website',
                          onClick: () => setPendingDelete(site),
                          disabled: Boolean(busyId) || deleting,
                          danger: true
                        }
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan="6" className="px-4 py-12 text-center text-sm text-slate-400">
                  No websites match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pendingDelete && (
        <ConfirmModal
          title="Delete website?"
          confirmLabel="Delete website"
          danger
          busy={deleting}
          onClose={() => {
            if (!deleting) setPendingDelete(null);
          }}
          onConfirm={confirmDelete}
        >
          <p>
            Are you sure you want to delete <span className="font-medium text-slate-800">{pendingDelete.name}</span>?
          </p>
          <p className="mt-2 text-slate-500">{pendingDelete.url}</p>
          <p className="mt-3">This removes the website and related monitoring records. This cannot be undone.</p>
        </ConfirmModal>
      )}
    </div>
  );
}

function displayHost(url) {
  try {
    const parsed = new URL(url);
    return parsed.host + (parsed.pathname !== '/' ? parsed.pathname.replace(/\/$/, '') : '');
  } catch {
    return url;
  }
}
