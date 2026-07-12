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
-- Lets supplier_refund payments track which ticket they were recorded against,
-- so editing the payment's amount later can cascade to that ticket's refund_received.
-- (client_refund already has this via a ticket_payments row; supplier_refund never did.)
ALTER TABLE payments ADD COLUMN ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL;
```

```sql
-- Per-agent payment channels ("wallets") — replaces the hardcoded 10-value
-- CHANNELS list. Additive only: payments.channel (text) is untouched, a new
-- nullable channel_id is added alongside it. Existing payments are backfilled
-- by exact string match against the 10 known values already in use.

-- 1. New table
CREATE TABLE payment_channels (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT payment_channels_unique_name_per_agent UNIQUE (agent_id, lower(name))
);

ALTER TABLE payment_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agents_own_payment_channels" ON payment_channels
  FOR ALL
  USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()))
  WITH CHECK (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

-- 2. New nullable column on payments
ALTER TABLE payments ADD COLUMN channel_id uuid REFERENCES payment_channels(id) ON DELETE SET NULL;

-- 3. Seed the 10 default channels for every existing agent
INSERT INTO payment_channels (agent_id, name)
SELECT a.id, c.name
FROM agents a
CROSS JOIN (VALUES ('Cash'), ('bKash'), ('Bank'), ('Office'), ('EBL'), ('DBBL'), ('IBBL'), ('City'), ('BRAC'), ('UCB')) AS c(name)
ON CONFLICT (agent_id, lower(name)) DO NOTHING;

-- 4. Defensive: catch any distinct channel value already in use that isn't one of the 10 defaults
INSERT INTO payment_channels (agent_id, name)
SELECT DISTINCT p.agent_id, p.channel
FROM payments p
WHERE p.channel IS NOT NULL
ON CONFLICT (agent_id, lower(name)) DO NOTHING;

-- 5. Backfill channel_id on existing payments by matching channel text -> the new wallet row
UPDATE payments p
SET channel_id = pc.id
FROM payment_channels pc
WHERE pc.agent_id = p.agent_id
  AND lower(pc.name) = lower(p.channel)
  AND p.channel_id IS NULL;
```

Verify after running, should return 0 in the `missed` column:
```sql
SELECT count(*) AS total, count(channel_id) AS backfilled,
       count(*) FILTER (WHERE channel IS NOT NULL AND channel_id IS NULL) AS missed
FROM payments;
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
