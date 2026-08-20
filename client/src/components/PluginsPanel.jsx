import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Download,
  LoaderCircle,
  RefreshCw,
  XCircle
} from 'lucide-react';
import { api } from '../services/api.js';
import { useData } from '../context/DataContext.jsx';
import StatusBadge from './StatusBadge.jsx';
import ConfirmModal from './ConfirmModal.jsx';

export default function PluginsPanel({ website }) {
  const { pluginUpdateProgress, pushToast } = useData();
  const plugins = website?.wordpress?.plugins || [];
  const outdated = plugins.filter((plugin) => plugin.updateAvailable);
  const progress = pluginUpdateProgress[website.id];
  const running = progress?.status === 'running';
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const busy = running || starting;
  const connected = website?.wordpressConnection?.status === 'connected';
  const summary = jobSummary(progress);

  async function startUpdate({ slug, all }) {
    setStarting(true);
    try {
      if (all) {
        await api(`/websites/${website.id}/plugins/update-all`, { method: 'POST', body: {} });
      } else {
        await api(`/websites/${website.id}/plugins/${encodeURIComponent(slug)}/update`, {
          method: 'POST',
          body: {}
        });
      }
    } catch (error) {
      pushToast({
        tone: 'error',
        persist: true,
        title: 'Plugin update failed',
        body: error.message || 'The update could not be started.'
      });
    } finally {
      setStarting(false);
    }
  }

  function pluginProgress(plugin) {
    return progress?.items?.find((item) => item.slug === plugin.slug);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-ink-900">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">Plugin Update Management</h3>
          <p className="mt-1 text-sm text-slate-500">
            {plugins.length
              ? outdated.length
                ? `${outdated.length} of ${plugins.length} plugin${plugins.length === 1 ? '' : 's'} ${outdated.length === 1 ? 'has' : 'have'} an available update.`
                : `All ${plugins.length} installed plugin${plugins.length === 1 ? '' : 's'} ${plugins.length === 1 ? 'is' : 'are'} up to date.`
              : 'No installed plugins were detected for this website yet.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={busy || outdated.length === 0}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
          {busy ? progressMessage(progress, outdated.length) : 'Update All Plugins'}
        </button>
      </div>

      {!connected && outdated.length > 0 && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Connect WordPress before updating plugins. Updates use the saved admin connection on the server.
        </p>
      )}

      {progress && (
        <div
          className={`mt-4 rounded-2xl border p-4 ${
            progress.status === 'running'
              ? 'border-sky-200 bg-sky-50'
              : progress.status === 'completed'
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-amber-200 bg-amber-50'
          }`}
        >
          <div className="flex items-start gap-2">
            {progress.status === 'running' ? (
              <LoaderCircle size={18} className="mt-0.5 animate-spin text-sky-700" />
            ) : progress.status === 'completed' ? (
              <CheckCircle2 size={18} className="mt-0.5 text-emerald-600" />
            ) : (
              <AlertTriangle size={18} className="mt-0.5 text-amber-600" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">
                {progress.status === 'running' ? progressMessage(progress, progress.total) : summary.title}
              </p>
              {progress.status === 'running' && progress.current?.status === 'updating' && (
                <p className="mt-1 text-sm text-slate-600">Currently updating {progress.current.name}</p>
              )}
              {progress.status !== 'running' && summary.lines.length > 0 && (
                <div className="mt-2 space-y-1 text-sm text-slate-700">
                  {summary.lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              )}
              <div className="mt-3 space-y-2">
                {(progress.items || []).map((item) => (
                  <div key={item.slug} className="flex items-start justify-between gap-3 text-sm text-slate-700">
                    <div className="flex min-w-0 items-center gap-2">
                      <ProgressIcon status={item.status} />
                      <span className="truncate font-medium">{item.name}</span>
                    </div>
                    <span className="shrink-0 text-xs text-slate-500">{itemStatusLabel(item.status)}</span>
                  </div>
                ))}
              </div>
              {progress.status !== 'running' && progress.failed > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-rose-700">
                  {(progress.items || [])
                    .filter((item) => item.status === 'failed')
                    .map((item) => (
                      <li key={`fail-${item.slug}`}>
                        {item.name}: {item.error || 'Update failed'}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {plugins.length > 0 && (
        <>
          <div className="mt-5 hidden overflow-x-auto md:block">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Plugin</th>
                  <th className="px-3 py-2 font-medium">Current version</th>
                  <th className="px-3 py-2 font-medium">Available version</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="py-2 pl-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {plugins.map((plugin) => {
                  const item = pluginProgress(plugin);
                  const status = pluginStatus(plugin, item);
                  return (
                    <tr key={plugin.slug} className="border-b border-slate-100 last:border-b-0">
                      <td className="py-3 pr-3 font-medium text-slate-900">{plugin.name}</td>
                      <td className="px-3 py-3 text-slate-600">{plugin.version || 'Unknown'}</td>
                      <td className="px-3 py-3 text-slate-600">{availableVersion(plugin, item)}</td>
                      <td className="px-3 py-3">
                        <StatusBadge status={status} />
                      </td>
                      <td className="py-3 pl-3 text-right">
                        <UpdateButton
                          plugin={plugin}
                          item={item}
                          busy={busy}
                          onUpdate={() => startUpdate({ slug: plugin.slug })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 space-y-3 md:hidden">
            {plugins.map((plugin) => {
              const item = pluginProgress(plugin);
              const status = pluginStatus(plugin, item);
              return (
                <div key={plugin.slug} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-slate-900">{plugin.name}</p>
                    <StatusBadge status={status} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                    <div>
                      <dt>Current version</dt>
                      <dd className="mt-0.5 font-medium text-slate-800">{plugin.version || 'Unknown'}</dd>
                    </div>
                    <div>
                      <dt>Available version</dt>
                      <dd className="mt-0.5 font-medium text-slate-800">{availableVersion(plugin, item)}</dd>
                    </div>
                  </dl>
                  <div className="mt-3">
                    <UpdateButton
                      plugin={plugin}
                      item={item}
                      busy={busy}
                      onUpdate={() => startUpdate({ slug: plugin.slug })}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {confirmOpen && (
        <ConfirmModal
          title="Update all plugins?"
          confirmLabel="Update All Plugins"
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            startUpdate({ all: true });
          }}
          busy={busy}
        >
          <p>Are you sure you want to update all available plugins?</p>
          <p className="mt-2 font-medium text-slate-800">
            {outdated.length} plugin{outdated.length === 1 ? '' : 's'} will be updated.
          </p>
          <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-slate-500">
            {outdated.map((plugin) => (
              <li key={plugin.slug}>
                {plugin.name}
                {plugin.version && plugin.latestVersion ? ` · ${plugin.version} → ${plugin.latestVersion}` : ''}
              </li>
            ))}
          </ul>
        </ConfirmModal>
      )}
    </section>
  );
}

function UpdateButton({ plugin, item, busy, onUpdate }) {
  const updatingThis = item?.status === 'updating';
  const canUpdate = plugin.updateAvailable || item?.status === 'failed';
  if (!canUpdate) return <span className="text-xs text-slate-400">—</span>;

  return (
    <button
      type="button"
      onClick={onUpdate}
      disabled={busy}
      className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-ink-950 dark:text-slate-200 dark:hover:bg-white/5 sm:w-auto"
    >
      {updatingThis ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
      {updatingThis ? 'Updating...' : 'Update'}
    </button>
  );
}

function pluginStatus(plugin, item) {
  if (item?.status === 'updating') return 'updating';
  if (item?.status === 'success') return 'updated successfully';
  if (item?.status === 'failed') return 'update failed';
  if (plugin.updateAvailable) return 'update available';
  return 'up to date';
}

function availableVersion(plugin, item) {
  if (item?.status === 'success' && (item.newVersion || plugin.version)) {
    return item.newVersion || plugin.version;
  }
  return plugin.latestVersion || plugin.version || '—';
}

function itemStatusLabel(status) {
  if (status === 'success') return 'Updated Successfully';
  if (status === 'failed') return 'Update Failed';
  if (status === 'updating') return 'Updating';
  return 'Waiting';
}

function jobSummary(progress) {
  if (!progress || progress.status === 'running') return { title: '', lines: [] };
  const lines = [];
  if (progress.succeeded) {
    lines.push(`${progress.succeeded} plugin${progress.succeeded === 1 ? '' : 's'} updated successfully`);
  }
  if (progress.failed) {
    lines.push(`${progress.failed} plugin${progress.failed === 1 ? '' : 's'} failed to update`);
  }
  return {
    title: lines[0] || progress.message || 'Plugin update finished.',
    lines: lines.slice(lines[0] ? 1 : 0)
  };
}

function progressMessage(progress, fallbackTotal) {
  const total = progress?.total || fallbackTotal || 0;
  const index = progress?.index || 1;
  if (!total) return 'Updating plugins...';
  return `Updating ${Math.min(index, total)} of ${total} plugins`;
}

function ProgressIcon({ status }) {
  if (status === 'success') return <CheckCircle2 size={16} className="text-emerald-600" />;
  if (status === 'failed') return <XCircle size={16} className="text-rose-600" />;
  if (status === 'updating') return <LoaderCircle size={16} className="animate-spin text-sky-600" />;
  return <Circle size={16} className="text-slate-300" />;
}
