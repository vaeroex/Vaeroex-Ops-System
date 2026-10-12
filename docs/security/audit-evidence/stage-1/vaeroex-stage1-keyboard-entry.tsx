import { createRoot } from 'react-dom/client';
import { RecordDetailDrawer } from '@/components/operations/RecordDetailDrawer';
import { GlobalSearch } from '@/components/app/GlobalSearch';
createRoot(document.getElementById('fixture')!).render(<main><h1>Synthetic keyboard audit fixture</h1><button id="before">Outside before</button><RecordDetailDrawer title="Synthetic record" triggerLabel="Open synthetic record"><label>Inside details<input id="inside" name="synthetic" /></label><button id="inside-last">Inside last</button></RecordDetailDrawer><button id="after">Outside after</button><GlobalSearch /><button id="last">Outside last</button></main>);
