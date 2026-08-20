import { useState } from 'react';
import { useData } from '../context/DataContext.jsx';
import WebsiteTable from '../components/WebsiteTable.jsx';
import WebsiteFormModal from '../components/WebsiteFormModal.jsx';

export default function Websites() {
  const { websites, upsertWebsite } = useData();
  const [modal, setModal] = useState(null);

  return (
    <div>
      <WebsiteTable
        websites={websites}
        onEdit={(site) => setModal(site)}
        actions={
          <button
            type="button"
            onClick={() => setModal({})}
            className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            Add website
          </button>
        }
      />
      {modal && (
        <WebsiteFormModal
          website={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={(saved) => {
            if (saved) upsertWebsite(saved);
            setModal(null);
          }}
        />
      )}
    </div>
  );
}
