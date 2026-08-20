import { Link } from 'react-router-dom';
import StatCard from '../components/StatCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useData } from '../context/DataContext.jsx';
import { formatDateTime } from '../utils/time.js';

export default function Dashboard() {
  const { stats, websites, notifications, incidents, monitoring } = useData();
  const offline = websites.filter((site) => site.status === 'offline');
  const activeIncidents = incidents.filter((item) => item.status === 'active' && item.type !== 'form');

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          {monitoring.running
            ? 'A monitoring cycle is running now.'
            : 'Automatic monitoring is active. No page refresh required.'}
        </p>
        <StatusBadge status={monitoring.running ? 'monitoring' : 'online'} />
      </div>

      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">Overview</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Websites"
            value={stats.totalWebsites}
            hint={`${stats.leadWebsites} leads · ${stats.nonLeadWebsites} non-leads`}
          />
          <StatCard
            label="Offline"
            value={stats.websitesOffline}
            hint="Sites currently unreachable"
            tone={stats.websitesOffline ? 'red' : 'green'}
          />
          <StatCard
            label="WordPress updates"
            value={stats.wordpressUpdates}
            hint="Core version updates"
          />
          <StatCard
            label="Plugin updates"
            value={stats.pluginUpdates}
            hint={`${stats.themeUpdates} theme updates`}
            tone={stats.pluginUpdates ? 'amber' : 'green'}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <MetricChip label="Theme updates" value={stats.themeUpdates} />
          <MetricChip label="Unread" value={stats.unreadNotifications} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">Website health</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-ink-900">
          {websites.slice(0, 8).map((site) => (
            <div
              key={site.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 dark:border-slate-800"
            >
              <Link to={`/websites/${site.id}`} className="min-w-0 text-sm font-medium text-slate-900 hover:text-teal-700 dark:text-slate-100">
                {site.name}
              </Link>
              <span className="inline-flex items-center gap-2 text-xs">
                Status
                <StatusBadge compact status={site.status === 'online' ? 'working' : site.status} />
              </span>
            </div>
          ))}
          {websites.length === 0 && <Empty text="No websites yet." />}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Needs attention" to="/websites">
          {offline.length === 0 && <Empty text="Nothing critical right now." />}
          {offline.map((site) => (
            <Row key={site.id} title={site.name} subtitle={site.url} status="offline" meta={site.lastError} />
          ))}
        </Panel>

        <Panel title="Notifications" to="/notifications">
          {notifications.length === 0 && <Empty text="No notifications yet." />}
          {notifications.slice(0, 6).map((item) => (
            <Row
              key={item.id}
              title={item.title}
              subtitle={item.message}
              status={item.severity}
              meta={formatDateTime(item.createdAt).label}
            />
          ))}
        </Panel>

        <Panel title="Incidents" to="/history">
          {activeIncidents.length === 0 && <Empty text="No active incidents." />}
          {activeIncidents.slice(0, 6).map((item) => (
            <Row
              key={item.id}
              title={item.type}
              subtitle={item.errorMessage}
              status={item.status}
              meta={formatDateTime(item.startedAt).label}
            />
          ))}
        </Panel>
      </div>
    </div>
  );
}

function MetricChip({ label, value }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 dark:border-slate-800 dark:bg-ink-900 dark:text-slate-300">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold tabular-nums">{value ?? 0}</span>
    </span>
  );
}

function Panel({ title, to, children }) {
  return (
    <section className="flex min-h-[220px] flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-ink-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</h2>
        <Link to={to} className="text-xs text-slate-500 hover:text-teal-700 dark:hover:text-teal-400">
          View all
        </Link>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">{children}</div>
    </section>
  );
}

function Row({ title, subtitle, status, meta }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{title}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>
      </div>
      <div className="shrink-0 text-right">
        <StatusBadge status={status} />
        {meta ? <p className="mt-1 max-w-[180px] truncate text-[11px] text-slate-400">{meta}</p> : null}
      </div>
    </div>
  );
}

function Empty({ text }) {
  return <p className="px-4 py-10 text-center text-sm text-slate-400">{text}</p>;
}
