import { useState } from 'react';
import StatusBadge from './StatusBadge.jsx';
import ActionMenu from './ActionMenu.jsx';
import { api } from '../services/api.js';
import { formatDateTime } from '../utils/time.js';
import { useData } from '../context/DataContext.jsx';

const GENERIC_FAILURE = 'WordPress connection failed. Please verify the WordPress Admin URL and credentials.';

function connectionState(connection) {
  if (connection.status === 'connected') {
    return { badge: 'connected', marker: 'Connected' };
  }
  if (connection.status === 'failed') {
    return { badge: 'connection failed', marker: 'Connection Failed' };
  }
  if (connection.configured || connection.status === 'configured') {
    return { badge: 'configured', marker: 'Configured' };
  }
  return { badge: 'not configured', marker: 'Not Configured' };
}

export default function WordPressConnectionCard({ website, onEdit }) {
  const { upsertWebsite } = useData();
  const connection = website?.wordpressConnection || { status: 'not_configured', configured: false };
  const state = connectionState(connection);
  const canTest = Boolean(connection.configured || ['configured', 'connected', 'failed'].includes(connection.status));
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  async function testConnection() {
    setTesting(true);
    setResult({ pending: true, message: 'Testing connection...' });
    try {
      const data = await api(`/websites/${website.id}/test-connection`, { method: 'POST', body: {} });
      if (data.website) upsertWebsite(data.website);
      setResult(data);
    } catch {
      setResult({
        success: false,
        error: GENERIC_FAILURE,
        steps: []
      });
    } finally {
      setTesting(false);
    }
  }

  function openAdmin() {
    if (!connection.adminUrl) return;
    window.open(connection.adminUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-ink-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">WordPress Connection</h3>
          <p className="mt-1 text-sm text-slate-500">{state.marker}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={state.badge} />
          <ActionMenu
            items={[
              { label: connection.configured ? 'Edit connection' : 'Configure and connect', onClick: onEdit },
              {
                label: testing ? 'Testing...' : 'Test connection',
                onClick: testConnection,
                disabled: !canTest || testing
              },
              { label: 'Open WordPress admin', onClick: openAdmin, disabled: !connection.adminUrl }
            ]}
          />
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Admin URL</dt>
          <dd className="break-all font-medium">{connection.adminUrl || '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Username</dt>
          <dd className="font-medium">{connection.username || '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Password</dt>
          <dd className="tracking-widest text-slate-500">{connection.configured ? connection.passwordMasked || '••••••••••' : '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Last connected</dt>
          <dd className="font-medium">{connection.lastConnectedAt ? formatDateTime(connection.lastConnectedAt).label : '—'}</dd>
        </div>
      </dl>

      {result && (
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm dark:bg-white/5">
          {result.pending && <p>Testing connection...</p>}
          {result.steps?.map((step) => (
            <p key={step.key} className={step.ok ? 'text-emerald-700' : 'text-rose-700'}>
              {step.ok ? '✓' : '✕'} {step.label}
            </p>
          ))}
          {result.success && (
            <p className="mt-2 text-emerald-800">
              Last connected: {formatDateTime(result.lastConnectedAt).label}
            </p>
          )}
          {result.success === false && <p className="mt-2 text-rose-700">{GENERIC_FAILURE}</p>}
        </div>
      )}
    </section>
  );
}
