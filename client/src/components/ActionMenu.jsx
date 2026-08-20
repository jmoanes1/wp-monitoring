import { Fragment, useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

/**
 * Hides secondary actions behind a single ⋯ control until the user opens it.
 */
export default function ActionMenu({ items = [], align = 'right', label = 'Actions' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const visible = items.filter(Boolean);

  useEffect(() => {
    function onPointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  if (!visible.length) return null;

  return (
    <div className="relative inline-flex" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200"
        aria-label={label}
        aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div
          className={`absolute z-30 mt-1 min-w-[11.5rem] rounded-lg border border-slate-200 bg-white p-1 shadow-md dark:border-slate-700 dark:bg-ink-900 ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          {visible.map((item, index) => {
            const showDivider = item.danger && index > 0 && !visible[index - 1].danger;
            return (
              <Fragment key={item.label}>
                {showDivider && <div className="my-1 border-t border-slate-100 dark:border-slate-800" />}
                <button
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onClick?.();
                  }}
                  className={`block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-40 ${
                    item.danger
                      ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50'
                      : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/10'
                  }`}
                >
                  {item.label}
                </button>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
