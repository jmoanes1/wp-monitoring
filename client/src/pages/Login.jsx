import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Gauge } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

const fieldClass =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-300 dark:border-slate-700 dark:bg-ink-950 dark:text-slate-100';

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(username, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-ink-950">
      <div className="absolute right-3 top-3">
        <ThemeToggle />
      </div>

      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500 text-white">
            <Gauge size={16} />
          </div>
          <div>
            <h1 className="text-sm font-medium text-slate-900 dark:text-slate-100">WP Monitor</h1>
            <p className="text-xs text-slate-400">Sign in</p>
          </div>
        </div>

        <label className="block text-xs text-slate-500">
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className={fieldClass}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label className="mt-3 block text-xs text-slate-500">
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={fieldClass}
            autoComplete="current-password"
          />
        </label>

        {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-5 w-full rounded-lg bg-slate-900 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
