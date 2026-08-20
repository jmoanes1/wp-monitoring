import { useState } from 'react';
import { useData } from '../context/DataContext.jsx';
import WebsiteTable from '../components/WebsiteTable.jsx';
import WebsiteFormModal from '../components/WebsiteFormModal.jsx';

export default function NonLeads() {
  const { websites, upsertWebsite } = useData();
  const [modal, setModal] = useState(null);
  const nonLeads = websites.filter((site) => site.type === 'non-lead');

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">Only websites classified as non-lead.</p>
      <WebsiteTable websites={nonLeads} onEdit={(site) => setModal(site)} />
      {modal && (
        <WebsiteFormModal
          website={modal}
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
