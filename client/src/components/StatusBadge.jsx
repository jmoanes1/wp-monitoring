import { labelStatus, STATUS_STYLES } from '../utils/status.js';

export default function StatusBadge({ status, compact = false }) {
  const key = String(status || 'unknown').toLowerCase();
  return (
    <span
      className={`inline-flex items-center font-medium ring-1 ring-inset ${
        compact ? 'rounded-md px-1.5 py-0.5 text-[11px]' : 'rounded-full px-2.5 py-1 text-xs'
      } ${STATUS_STYLES[key] || STATUS_STYLES.unknown}`}
    >
      {labelStatus(key)}
    </span>
  );
}
