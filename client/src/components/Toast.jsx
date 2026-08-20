import { AlertTriangle, CheckCircle2, Info, LoaderCircle, X, XCircle } from 'lucide-react';
import { useData } from '../context/DataContext.jsx';

const tones = {
  critical: 'border-rose-200 bg-rose-50 text-rose-950',
  error: 'border-rose-200 bg-rose-50 text-rose-950',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  warning: 'border-amber-200 bg-amber-50 text-amber-950',
  info: 'border-sky-200 bg-sky-50 text-sky-950',
  loading: 'border-sky-200 bg-white text-slate-900 dark:border-sky-800 dark:bg-ink-900 dark:text-slate-100'
};

export default function ToastStack() {
  const { toasts, dismissToast } = useData();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-3 px-4 sm:px-0">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-2xl border p-4 shadow-lg ${tones[toast.tone] || tones.info}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <ToastIcon tone={toast.tone} />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.lines?.length ? (
                  <div className="mt-2 space-y-1 text-sm opacity-80">
                    {toast.lines.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                ) : (
                  toast.body && <p className="mt-1 text-sm opacity-80">{toast.body}</p>
                )}
              </div>
            </div>
            <button type="button" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification">
              <X size={16} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ToastIcon({ tone }) {
  if (tone === 'loading') return <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin text-sky-600" />;
  if (tone === 'success') return <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />;
  if (tone === 'error' || tone === 'critical') return <XCircle size={16} className="mt-0.5 shrink-0 text-rose-600" />;
  if (tone === 'warning') return <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />;
  return <Info size={16} className="mt-0.5 shrink-0 text-sky-600" />;
}
