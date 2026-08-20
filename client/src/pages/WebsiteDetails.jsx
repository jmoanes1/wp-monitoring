import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useData } from '../context/DataContext.jsx';
import { api } from '../services/api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import WebsiteFormModal from '../components/WebsiteFormModal.jsx';
import WordPressConnectionCard from '../components/WordPressConnectionCard.jsx';
import ActionMenu from '../components/ActionMenu.jsx';
import PluginsPanel from '../components/PluginsPanel.jsx';
import { formatDateTime, formatDuration } from '../utils/time.js';

const tabs = ['Overview', 'WordPress', 'Plugins', 'Themes', 'SSL', 'Incidents', 'History'];

export default function WebsiteDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { websites, updates, incidents, history, upsertWebsite, pushToast } = useData();
  const [tab, setTab] = useState('Overview');
  const [busy, setBusy] = useState('');
  const [editOpen, setEditOpen] = useState(false);

  const website = websites.find((item) => item.id === id);
  const siteUpdates = updates.filter((item) => item.websiteId === id);
  const siteIncidents = incidents.filter((item) => item.websiteId === id && item.type !== 'form');
  const siteHistory = history.filter((item) => item.websiteId === id && item.type !== 'form');
  const themes = website?.wordpress?.themes || [];
  const pluginUpdateCount = (website?.wordpress?.plugins || []).filter((plugin) => plugin.updateAvailable).length;

  async function run(action) {
    setBusy(action);
    try {
      if (action === 'test') await api(`/websites/${id}/test`, { method: 'POST' });
      if (action === 'updates') await api(`/websites/${id}/check-updates`, { method: 'POST' });
    } catch (error) {
      pushToast({
        tone: 'error',
        persist: true,
        title: 'Action failed',
        body: error.message || 'Please try again.'
      });
    } finally {
      setBusy('');
    }
  }

  async function changeType(type) {
    await api(`/websites/${id}`, { method: 'PUT', body: { type } });
  }

  async function toggleMonitoring() {
    await api(`/websites/${id}`, { method: 'PUT', body: { monitoringEnabled: !website.monitoringEnabled } });
  }

  async function remove() {
    if (!window.confirm(`Delete ${website.name}? This removes related monitoring records.`)) return;
    await api(`/websites/${id}`, { method: 'DELETE' });
    navigate('/websites');
  }

  if (!website) {
    return <p className="text-sm text-slate-500">Website not found or still loading.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/websites" className="text-sm text-teal-700 dark:text-teal-400">
            ← All websites
          </Link>
          <h2 className="mt-1 text-2xl font-semibold">{website.name}</h2>
          <a href={website.url} target="_blank" rel="noreferrer" className="text-sm text-slate-500">
            {website.url}
          </a>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusBadge status={website.status} />
            <StatusBadge status={website.type} />
            <StatusBadge status={website.monitoringEnabled ? 'monitoring' : 'disabled'} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ActionMenu
            items={[
              { label: 'Edit website', onClick: () => setEditOpen(true) },
              { label: busy === 'test' ? 'Testing website...' : 'Test website', onClick: () => run('test'), disabled: Boolean(busy) },
              { label: busy === 'updates' ? 'Checking updates...' : 'Check updates', onClick: () => run('updates'), disabled: Boolean(busy) },
              {
                label: website.monitoringEnabled ? 'Disable monitoring' : 'Enable monitoring',
                onClick: toggleMonitoring
              },
              { label: 'Delete website', onClick: remove, danger: true }
            ]}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Response" value={website.responseTime ? `${website.responseTime}ms` : '—'} />
        <Metric label="Last checked" value={formatDateTime(website.lastCheckedAt).time} hint={formatDateTime(website.lastCheckedAt).date} />
        <Metric label="SSL" value={website.ssl?.applicable ? (website.ssl.valid ? 'Valid' : 'Issue') : 'N/A'} />
      </div>

      <WordPressConnectionCard website={website} onEdit={() => setEditOpen(true)} />

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {tabs.map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={`inline-flex items-center gap-2 whitespace-nowrap px-3 py-2 text-sm ${
              tab === item ? 'border-b-2 border-slate-900 font-medium text-slate-900 dark:border-white dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {item}
            {item === 'Plugins' && pluginUpdateCount > 0 && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                {pluginUpdateCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <section className="grid gap-4 lg:grid-cols-2">
          <Card title="Classification">
            <p className="text-sm text-slate-600">Move this website between lead and non-lead. The change appears immediately in both lists.</p>
            <select
              value={website.type}
              onChange={(event) => changeType(event.target.value)}
              className="mt-3 w-full max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-ink-950"
            >
              <option value="lead">Lead</option>
              <option value="non-lead">Non-Lead</option>
            </select>
          </Card>
          <Card title="Availability">
            <p>HTTP {website.httpStatus || '—'}</p>
            <p className="text-sm text-slate-500">{website.lastError || 'No current availability error.'}</p>
          </Card>
        </section>
      )}

      {tab === 'WordPress' && (
        <Card title="WordPress core">
          {website.wordpress?.detected ? (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-slate-500">Current version</dt>
                <dd className="text-lg font-semibold">{website.wordpress.version || 'Detected, version unknown'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Available version</dt>
                <dd className="text-lg font-semibold">{website.wordpress.latestVersion || '—'}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">WordPress was not detected from public HTML/REST/feed signals.</p>
          )}
          {website.wordpress?.updateAvailable && <p className="mt-3 text-amber-700">Update available</p>}
          {siteUpdates.filter((item) => item.status === 'pending').length > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {siteUpdates
                .filter((item) => item.status === 'pending')
                .map((item) => (
                  <li key={item.id}>
                    {item.name}: {item.currentVersion || 'unknown'} → {item.availableVersion}
                  </li>
                ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'Plugins' && <PluginsPanel website={website} />}

      {tab === 'Themes' && (
        <Card title="Detected themes">
          {themes.map((theme) => (
            <div key={theme.slug} className="flex items-center justify-between border-b py-2 last:border-b-0">
              <div>
                <p className="font-medium">{theme.name}</p>
                <p className="text-xs text-slate-500">
                  {theme.version || 'Unknown'} {theme.latestVersion ? `→ ${theme.latestVersion}` : ''}
                </p>
              </div>
              <StatusBadge status={theme.updateAvailable ? 'warning' : 'updated'} />
            </div>
          ))}
          {themes.length === 0 && <p className="text-sm text-slate-500">No theme paths were visible in public HTML.</p>}
        </Card>
      )}

      {tab === 'SSL' && (
        <Card title="SSL certificate">
          {website.ssl?.applicable ? (
            <div className="space-y-2">
              <StatusBadge status={website.ssl.valid ? 'online' : 'warning'} />
              <p>Expires {website.ssl.expiresAt ? formatDateTime(website.ssl.expiresAt).date : '—'}</p>
              <p className="text-sm text-slate-500">
                {website.ssl.daysRemaining != null ? `${website.ssl.daysRemaining} days remaining` : website.ssl.error}
              </p>
              <p className="text-xs text-slate-400">Issuer: {website.ssl.issuer || 'Unknown'}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">This site is not served over HTTPS.</p>
          )}
        </Card>
      )}

      {tab === 'Incidents' && (
        <Card title="Incidents">
          {siteIncidents.map((item) => (
            <div key={item.id} className="border-b py-3 last:border-b-0">
              <div className="flex items-center justify-between">
                <p className="font-medium capitalize">{item.type}</p>
                <StatusBadge status={item.status} />
              </div>
              <p className="text-sm text-slate-500">{item.errorMessage}</p>
              <p className="text-xs text-slate-400">
                Started {formatDateTime(item.startedAt).label}
                {item.resolvedAt ? ` · Recovered ${formatDateTime(item.resolvedAt).label} · ${formatDuration(item.downtimeSeconds)}` : ''}
              </p>
            </div>
          ))}
          {siteIncidents.length === 0 && <p className="text-sm text-slate-500">No incidents recorded.</p>}
        </Card>
      )}

      {tab === 'History' && (
        <Card title="Monitoring history">
          {siteHistory.slice(0, 50).map((item) => (
            <div key={item.id} className="flex items-center justify-between border-b py-2 text-sm last:border-b-0">
              <div>
                <p>{item.message}</p>
                <p className="text-xs text-slate-400">{formatDateTime(item.checkedAt).label}</p>
              </div>
              <StatusBadge status={item.newStatus} />
            </div>
          ))}
        </Card>
      )}
      {editOpen && (
        <WebsiteFormModal
          website={website}
          onClose={() => setEditOpen(false)}
          onSaved={(saved) => {
            if (saved) upsertWebsite(saved);
            setEditOpen(false);
          }}
        />
      )}
    </div>
  );
}

function Card({ title, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-ink-900">
      <h3 className="mb-3 font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Metric({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-ink-900">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
