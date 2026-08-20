import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { api } from '../services/api.js';

const empty = {
  name: '',
  url: '',
  type: 'lead',
  monitoringEnabled: true,
  notes: ''
};

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-300 dark:border-slate-700 dark:bg-ink-950 dark:text-slate-100';

function guessAdminUrl(siteUrl) {
  try {
    if (!siteUrl || !String(siteUrl).trim()) return '';
    const raw = String(siteUrl).trim();
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const base = withProtocol.endsWith('/') ? withProtocol : `${withProtocol}/`;
    return new URL('wp-admin', base).toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export default function WebsiteFormModal({ website, onClose, onSaved }) {
  const connection = website?.wordpressConnection || {};
  const configured = Boolean(connection.configured);
  const [form, setForm] = useState({
    ...empty,
    ...(website
      ? {
          name: website.name,
          url: website.url,
          type: website.type,
          monitoringEnabled: website.monitoringEnabled,
          notes: website.notes || ''
        }
      : {})
  });
  const [adminUrl, setAdminUrl] = useState(connection.adminUrl || guessAdminUrl(website?.url || ''));
  const [username, setUsername] = useState(connection.username || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [changePassword, setChangePassword] = useState(!website || !configured);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState('');

  function updateSiteUrl(url) {
    const previousGuess = guessAdminUrl(form.url);
    setForm({ ...form, url });
    const guessed = guessAdminUrl(url);
    if (!adminUrl || adminUrl === previousGuess) {
      setAdminUrl(guessed);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      // Read live form fields so browser autofill is included.
      const fields = new FormData(event.currentTarget);
      const wpAdmin = String(fields.get('wordpressAdminUrl') || adminUrl || guessAdminUrl(form.url) || '').trim();
      const wpUser = String(fields.get('wordpressUsername') || username || '').trim();
      const wpPass = String(fields.get('wordpressPassword') || password || '');

      const payload = {
        name: form.name,
        url: form.url,
        type: form.type,
        monitoringEnabled: form.monitoringEnabled,
        notes: form.notes
      };

      const wantsConnect = Boolean(wpUser || wpPass);
      if (wantsConnect) {
        if (!wpUser) {
          setError('WordPress username is required to connect');
          setSaving(false);
          return;
        }
        if (!configured && !wpPass) {
          setError('WordPress password is required to connect');
          setSaving(false);
          return;
        }
        payload.wordpressAdminUrl = wpAdmin || guessAdminUrl(form.url);
        payload.wordpressUsername = wpUser;
        if (wpPass) payload.wordpressPassword = wpPass;
      }

      const websiteId = website?.id;
      const data = websiteId
        ? await api(`/websites/${websiteId}`, { method: 'PUT', body: payload })
        : await api('/websites', { method: 'POST', body: payload });

      setPassword('');
      if (data.connectorApiKey) setApiKey(data.connectorApiKey);
      onSaved?.(data.website);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4">
      <form
        onSubmit={submit}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-ink-900"
      >
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {website ? 'Edit website' : 'Add website'}
        </h2>

        <div className="mt-4 space-y-3">
          <Field label="Name">
            <input
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="URL">
            <input
              required
              value={form.url}
              onChange={(event) => updateSiteUrl(event.target.value)}
              placeholder="https://example.com"
              className={inputClass}
              autoComplete="off"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select
                value={form.type}
                onChange={(event) => setForm({ ...form, type: event.target.value })}
                className={inputClass}
              >
                <option value="lead">Lead</option>
                <option value="non-lead">Non-lead</option>
              </select>
            </Field>
            <label className="flex items-end gap-2 pb-2 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={form.monitoringEnabled}
                onChange={(event) => setForm({ ...form, monitoringEnabled: event.target.checked })}
              />
              Monitor
            </label>
          </div>
          <Field label="Notes">
            <textarea
              value={form.notes || ''}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              className={inputClass}
              rows="2"
            />
          </Field>
        </div>

        <p className="mt-5 text-xs font-medium text-slate-400">WordPress connection</p>
        <p className="mt-0.5 text-xs text-slate-400">Optional. Save to connect; status becomes Connected or Failed.</p>
        <div className="mt-3 space-y-3">
          <Field label="Admin URL">
            <input
              name="wordpressAdminUrl"
              value={adminUrl}
              onChange={(event) => setAdminUrl(event.target.value)}
              placeholder={guessAdminUrl(form.url) || 'https://example.com/wp-admin'}
              className={inputClass}
              autoComplete="off"
            />
          </Field>
          <Field label="Username">
            <input
              name="wordpressUsername"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin"
              className={inputClass}
              autoComplete="username"
            />
          </Field>
          {website && configured && !changePassword ? (
            <div>
              <p className="mb-1 text-xs text-slate-500">Password</p>
              <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                <span className="tracking-widest text-slate-400">{connection.passwordMasked || '••••••••••'}</span>
                <button
                  type="button"
                  onClick={() => setChangePassword(true)}
                  className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                >
                  Change
                </button>
              </div>
            </div>
          ) : (
            <Field label="Password">
              <div className="flex gap-2">
                <input
                  name="wordpressPassword"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={inputClass}
                  autoComplete="current-password"
                  placeholder={configured ? 'New password' : ''}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="rounded-lg px-2.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        {apiKey && (
          <p className="mt-3 text-xs text-slate-400">
            Connector API key (shown once): <code className="break-all text-slate-600 dark:text-slate-300">{apiKey}</code>
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-sm text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block text-xs text-slate-500">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}
