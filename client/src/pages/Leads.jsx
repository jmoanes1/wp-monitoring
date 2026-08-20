import { useState } from 'react';
import { useData } from '../context/DataContext.jsx';
import WebsiteTable from '../components/WebsiteTable.jsx';
import WebsiteFormModal from '../components/WebsiteFormModal.jsx';

export default function Leads() {
  const { websites, upsertWebsite } = useData();
  const [modal, setModal] = useState(null);
  const leads = websites.filter((site) => site.type === 'lead');

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">Only websites classified as lead. Move a site from its details page or by editing its type.</p>
      <WebsiteTable websites={leads} onEdit={(site) => setModal(site)} />
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
