# Operations Rules

## Environment
- Local dev: http://localhost:5173
- Production: https://ticket-tracker-henna.vercel.app
- Supabase project: vdpjgshdnaqczgjmardt (Mumbai ap-south-1)

## Environment Variables
- VITE_SUPABASE_URL — in .env.local only, never commit
- VITE_SUPABASE_ANON_KEY — in .env.local only, never commit
- .env.local is in .gitignore

## Dependencies (notable)
- jsPDF + jspdf-autotable — PDF generation for ledger reports (src/lib/generateLedgerPdf.js)
- lucide-react — icon library used across components
- xlsx — used in Settings page for data export
- react-router-dom — routing

## Git Rules
- Always commit before starting a new phase
- Commit message format: phase X: description
- Push to main triggers auto deploy on Vercel

## Supabase Storage
- Bucket: `documents` (private)
- Used for client and supplier document uploads
- Path format: `{agent_id}/{entity_type}/{entity_id}/{uuid}.{ext}`
- Access policy: agents can only manage files under their own agent_id folder
- Files accessed via signed URLs (1-hour expiry) generated on demand
- Maximum 5 documents per entity enforced in UI

## Required Database Setup (manual — run in SQL Editor)
When setting up a new environment, run:

```sql
-- Document metadata table
CREATE TABLE entity_documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('client', 'supplier')),
  entity_id uuid NOT NULL,
  doc_type text NOT NULL CHECK (doc_type IN ('Business Card', 'NID', 'Passport', 'Photo', 'Others')),
  file_name text NOT NULL,
  storage_path text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE entity_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agents_own_documents" ON entity_documents
  FOR ALL
  USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()))
  WITH CHECK (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));
```

Storage bucket policy (add via Supabase Dashboard → Storage → documents → Policies):
```sql
-- Allow agents to manage files under their own agent_id folder
-- Operations: SELECT, INSERT, UPDATE, DELETE
-- Expression:
bucket_id = 'documents'
AND (storage.foldername(name))[1] IN (
  SELECT id::text FROM agents WHERE user_id = auth.uid()
)
```

## Pending Migrations (manual — run in SQL Editor, existing environments)
Not yet applied to the live Supabase project — run once, then this section can be removed:

```sql
-- Optional starting balance per wallet, for money that was already in that
-- channel before the agent started logging payments in the app. Additive.
ALTER TABLE payment_channels ADD COLUMN starting_balance numeric NOT NULL DEFAULT 0;
```

## Folder Structure
- src/pages/agent/ — agent facing pages
- src/pages/agent/reports/ — report pages (Client Ledger, Supplier Ledger)
- src/pages/admin/ — admin facing pages
- src/components/ui/ — reusable components (SearchableDropdown, SearchableEntityDropdown, DocUploadSection, DocumentsTab)
- src/components/tickets/ — ticket components
- src/components/clients/ — client components
- src/components/suppliers/ — supplier components
- src/components/payments/ — payment components (LogTransactionModal, ViewPaymentModal)
- src/components/layout/ — layout components (AppLayout, Sidebar, AdminLayout)
- src/lib/ — supabase client, airlines list, PDF generation utility
- src/context/ — auth context
