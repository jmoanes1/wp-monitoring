export default function StatCard({ label, value, hint, tone = 'slate' }) {
  const valueTone = {
    slate: 'text-slate-900 dark:text-slate-100',
    green: 'text-emerald-700 dark:text-emerald-400',
    red: 'text-rose-700 dark:text-rose-400',
    amber: 'text-amber-700 dark:text-amber-400',
    blue: 'text-sky-700 dark:text-sky-400'
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-ink-900">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${valueTone[tone] || valueTone.slate}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
