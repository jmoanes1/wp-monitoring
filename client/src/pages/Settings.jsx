import { useState } from 'react';
import { useData } from '../context/DataContext.jsx';
import { api } from '../services/api.js';

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-300 dark:border-slate-700 dark:bg-ink-950 dark:text-slate-100';

export default function Settings() {
  const { settings, allowedIntervals, setSettings } = useData();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  if (!settings) return <p className="text-sm text-slate-400">Loading settings…</p>;

  async function save(changes) {
    const data = await api('/settings', { method: 'PUT', body: changes });
    setSettings(data.settings);
    setMessage('Settings saved.');
    setError('');
  }

  async function changePassword(event) {
    event.preventDefault();
    setError('');
    try {
      await api('/auth/password', { method: 'PUT', body: { currentPassword, newPassword } });
      setMessage('Password updated.');
      setError('');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function enableBrowserNotifications() {
    if (typeof Notification !== 'undefined') {
      await Notification.requestPermission();
    }
    await save({ browserNotifications: true });
  }

  return (
    <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-ink-900">
        <h2 className="text-sm font-medium text-slate-900 dark:text-slate-100">Monitoring</h2>
        <label className="mt-4 block text-xs text-slate-500">
          Interval
          <select
            value={settings.monitorIntervalMs}
            onChange={(event) => save({ monitorIntervalMs: Number(event.target.value) })}
            className={inputClass}
          >
            {allowedIntervals.map((item) => (
              <option key={item.ms} value={item.ms}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-1.5 text-xs text-slate-400">
          Timezone {settings.timezone}. Minimum interval is 5 minutes.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-500">
            SSL warning days
            <input
              type="number"
              defaultValue={settings.sslWarningDays}
              onBlur={(event) => save({ sslWarningDays: Number(event.target.value) })}
              className={inputClass}
            />
          </label>
          <label className="text-xs text-slate-500">
            SSL critical days
            <input
              type="number"
              defaultValue={settings.sslCriticalDays}
              onBlur={(event) => save({ sslCriticalDays: Number(event.target.value) })}
              className={inputClass}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={enableBrowserNotifications}
          className="mt-4 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-white/5"
        >
          Enable browser notifications
        </button>
        <p className="mt-4 text-xs text-slate-400">Email notifications for website alerts are not enabled.</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-ink-900">
        <h2 className="text-sm font-medium text-slate-900 dark:text-slate-100">Administrator password</h2>
        <form onSubmit={changePassword} className="mt-4 space-y-3">
          <label className="block text-xs text-slate-500">
            Current password
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs text-slate-500">
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={inputClass}
            />
          </label>
          <button type="submit" className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">
            Update password
          </button>
        </form>
        {message && <p className="mt-3 text-sm text-emerald-700">{message}</p>}
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      </section>
    </div>
  );
}
