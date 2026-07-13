# Database Rules

## Stack
Supabase (Postgres) hosted at ap-south-1 Mumbai
All tables have Row Level Security (RLS) enabled
Never disable RLS on any table

## Tables
- `agents` — one row per user. Links to auth.users via user_id. Contains plan, trial_ends_at, is_admin
- `clients` — belongs to agent via agent_id. Covers both trade clients (bulk buyers, ongoing relationship) and retail/walk-in passengers (one-off buyers). No toggle to distinguish — behaviour is determined by usage pattern. Has `client_id_number` — agent-scoped sequential integer (1, 2, 3…) assigned on insert as `COALESCE(MAX(client_id_number), 0) + 1` for that agent, displayed as `C-001`.
- `suppliers` — belongs to agent via agent_id. Has `supplier_id_number` — agent-scoped sequential integer assigned on insert the same way as clients, displayed as `S-001`.
- `tickets` — core table. belongs to agent. links to client and supplier. supports parent/child relationship for reissues.
- `payments` — one row per payment event. Linked to client or supplier. Never linked directly to tickets.
- `ticket_payments` — junction table. Links payments to tickets with allocated amounts. One row per ticket per payment. Standard relational many-to-many pattern.
- `entity_documents` — stores document metadata for clients and suppliers. Actual files live in Supabase Storage.
- `reminders` — email reminder rules per ticket

## Key Fields on Tickets
- purchase_price — total cost to agent. Mandatory. Used for all calculations (margin, payments, refunds). On reissue child tickets this is original_purchase + fare_difference + reissue_fee_paid.
- gds_price — optional. Raw airline/GDS cost before company markup. Label in form: Supplier Purchase Price. Informational only — no effect on any calculation. Pro plan feature (gated later).
- office_markup — auto-calculated on save as purchase_price - gds_price. Never entered in form. Stored silently. Used only for dashboard reporting of company contribution. Null if gds_price not entered.
- sell_price — actual price charged to client (real number, private). On reissue child tickets this is original_sell + fare_difference + reissue_fee_collected.
- issue_date — optional. Date the ticket was issued.
- amount_paid — derived from SUM(ticket_payments.allocated_amount) for this ticket
- payment_status — unpaid, partial, paid (derived from amount_paid vs sell_price)
- status — booked, collected, supplier_paid, flown, closed, reissued, void
- refund_status — null, initiated, supplier_refunded, client_refunded, closed. Derived, not manually set past initiation — see "Refund Architecture" below
- parent_ticket_id — nullable FK to tickets.id. Set when this ticket is a reissue of another.
- is_reissue — boolean. true if this ticket was created as a reissue of another ticket.
- is_void — boolean. true if ticket was voided.
- reissue_fee_collected — amount collected from client for reissue (stored for reference; already baked into sell_price)
- reissue_fee_paid — amount paid to supplier for reissue (stored for reference; already baked into purchase_price)
- fare_difference — price difference between old and new ticket on reissue (can be negative; already baked into sell_price and purchase_price)
- refund_receivable — expected refund amount from supplier
- refund_received — actual refund received from supplier
- refund_payable — agreed refund amount to pay client
- refund_paid — actual refund paid to client
- refund_notes — free-text note entered when initiating a refund (own column, not appended to narration)

## Margin Calculations

### Per Ticket
- ticket_margin = sell_price - purchase_price
- refund_margin = refund_received - refund_payable
- void_fee_margin = void_fee_collected - void_fee_paid
- net_margin = ticket_margin + refund_margin + void_fee_margin

Note: reissue fees and fare_difference are NOT separately added to net_margin. They are already embedded in sell_price and purchase_price on the child reissue ticket. Adding them again would double-count. void_fee_collected/void_fee_paid ARE separately added — they're a standalone transaction tied to the void event, not embedded in sell_price/purchase_price anywhere.

### Reissue Profit (display only, not added to net_margin)
- profit_from_reissue = reissue_fee_collected - reissue_fee_paid
- Shown in the reissue modal as a quick reference for the agent — the margin earned purely from the reissue transaction

### Chain Margin (parent + all reissued children)
- chain_net_margin = SUM(net_margin) across parent ticket and all tickets where parent_ticket_id = parent.id

### Dashboard Reporting
- Total Profit = SUM(net_margin) across all tickets in period
- Office Margin = SUM(office_markup) across all tickets in period
- Total Refunded to Clients = SUM(tickets.refund_paid) across all tickets — ticket-level, not the payments table. refund_paid is the running cumulative total (see "Refund Architecture"), kept in sync with the real client_refund payment rows by every recording path
- Open Refunds / Awaiting From Supplier / Owed To Clients — the refund lifecycle has 4 states (initiated -> supplier_refunded or client_refunded, whichever side settles first -> closed), derived by comparing cumulative actuals against agreed targets (see deriveRefundStatus in "Refund Architecture"). Awaiting From Supplier / Owed To Clients sum the actual remaining balance per ticket (`max(receivable - received, 0)` / `max(payable - paid, 0)`), not an all-or-nothing null check, so a partial receipt still counts toward what's left. Refund Net Margin only counts refund_status = closed (fully settled on both sides)

### Removed Fields
- reported_price — REMOVED. Do not use or reference anywhere.
- net (column) — REMOVED. Do not use or reference anywhere.

## Payment Architecture

### Core Concept
Payments are logged at the client or supplier level as a single event. Allocation to individual tickets happens via the ticket_payments junction table. A payment can cover many tickets. A ticket can be paid across many payments. No single payment owns a ticket.

### Payment Tables Schema

payments:
  id, agent_id
  client_id (nullable — set when receiving from client)
  supplier_id (nullable — set when paying supplier)
  ticket_id (nullable — set only on supplier_refund when linked to a ticket at creation; lets a later amount edit cascade to that ticket's refund_received. client_refund uses the ticket_payments link instead, not this column)
  type: client_payment | supplier_payment | client_refund | supplier_refund
  amount — total payment amount
  unallocated_amount — starts equal to amount, reduces as allocations are made, never goes below 0
  channel — legacy free-text column, kept in sync for safety but no longer the source of truth
  channel_id — FK to payment_channels. Source of truth for which wallet a payment used
  trx_id, notes, payment_date, created_at

ticket_payments:
  id, payment_id, ticket_id
  allocated_amount — amount from this payment applied to this ticket
  type: client | supplier | client_refund | supplier_refund | void_fee_client | void_fee_supplier
    - client / supplier: normal fare/purchase payments, positive allocated_amount, summed into amount_paid/supplierAmountPaid
    - client_refund: a client refund settled through the client-side AllocationModal (netted against a bulk client payment) — negative allocated_amount, reducing the ticket's amount_paid
    - supplier_refund: a supplier refund settled through the supplier-side SupplierAllocationModal (netted against a bulk outgoing supplier payment) — negative allocated_amount. Distinct from payments.type=supplier_refund (a standalone receipt, linked via payments.ticket_id instead — see "Refund Architecture")
    - void_fee_client / void_fee_supplier: cancellation fee payments, excluded from the amount_paid/supplierAmountPaid derivation (see Void Flow)
  created_at

payment_channels:
  id, agent_id
  name — per-agent, case-insensitive unique (enforced by a unique index on (agent_id, lower(name)), since a plain UNIQUE constraint can't take an expression)
  starting_balance — optional, defaults to 0. Balance already in that wallet before the agent started logging payments in the app
  is_active — false = archived. Archived channels are hidden from "select a channel" pickers on new payments but stay fully visible in history, filters, and Channel Ledger
  created_at
  New agents are seeded with 10 defaults on signup: Cash, bKash, Bank, Office, EBL, DBBL, IBBL, City, BRAC, UCB. Agents can add, rename, or archive from there.
  A channel with existing payments can never be hard-deleted — archive is the only removal path once it's in use.

### Balance Calculations
- Client total billed = SUM(tickets.sell_price) for all non-void tickets belonging to that client
- Client total received = SUM(payments.amount) for all client_payments for that client
- Ticket amount paid = SUM(ticket_payments.allocated_amount) for that ticket where type = client
- Ticket outstanding = sell_price - ticket amount paid — but only for tickets that are still eligible (see below); void or refund-active tickets contribute 0, not a raw subtraction
- Unallocated credit on client = SUM(payments.unallocated_amount) for that client
- Client/Supplier balance outstanding = SUM(ticket outstanding) across that entity's eligible tickets — computed per-ticket, not as totalBilled - totalReceived, so a void/refund-active ticket can't inflate the balance via a payments-side number it isn't actually tied to
- **Outstanding eligibility**: a ticket only contributes to any outstanding total (Dashboard's Collection Pending / Total Payable to Suppliers, Client/Supplier Detail's Outstanding Balance/Payable, the Outstanding column on Tickets/Client/Supplier tables) when `!is_void && refund_status == null`. Once a ticket is void, or has any refund activity at all (even just initiated), its money story is told by is_void/refund_* instead — amount_paid/purchase_price no longer represent a real collection/payable expectation for it, so it drops out entirely rather than being netted in. This prevents a settled-refund ticket (refund_status = closed) from still showing as fully outstanding just because amount_paid/payment_status were never touched by the refund flow (see "Editing a Logged Payment" above re: the two independent refund-tracking surfaces).

### Payment Flow (Client Side)
1. Agent receives bulk payment from client — logs amount, channel, trx_id
2. unallocated_amount starts at full payment amount
3. Allocation prompt shown immediately after logging payment:
   - Distribute evenly across all pending tickets
   - Select specific tickets — system fills sequentially oldest first until money runs out
   - Skip — payment sits as unallocated credit on client account
4. Each allocation inserts a row in ticket_payments and reduces unallocated_amount
5. ticket.payment_status updates based on new amount_paid vs sell_price
6. Multiple payments can contribute to one ticket — all are reported, no single owner

### Inline Payment (Ticket Form)
- Collapsible optional section at bottom of ticket modal
- Works for all ticket types — walk-in passenger or trade client
- If filled: creates payment row + ticket_payments allocation row on ticket save
- If left empty: ticket saves with payment_status = unpaid
- Paid in full checkbox disables the amount field and live-reflects the current sell_price; on save, uses the actual sell_price value

### Log Transaction Modal (Payments Page)
- 2-step modal: type selector → type-specific form
- Types: Client Payment (IN), Supplier Payment (OUT), Client Refund (OUT), Supplier Refund (IN)
- After logging a client_payment or supplier_payment, the AllocationModal is triggered automatically
- client_refund: unallocated_amount = 0; if linked to a ticket, inserts a ticket_payments row with type=client_refund and negative allocated_amount, then updates ticket.amount_paid/payment_status. If that ticket has an open refund on file (refund_status set and not closed), also adds the amount to the ticket's cumulative refund_paid and recomputes refund_status via deriveRefundStatus — otherwise it's treated as a plain fare refund with no formal refund tracking to advance
- supplier_refund: unallocated_amount = 0; if linked to a ticket with an open refund on file, adds the amount to the ticket's cumulative refund_received and recomputes refund_status via deriveRefundStatus (payments.ticket_id is always set when a ticket is picked, regardless of whether refund tracking was advanced — see Payment Tables Schema)

### Editing a Logged Payment (ViewPaymentModal)
- Any payment can be reopened and edited: amount, channel, trx_id, notes, payment_date
- client_payment / supplier_payment: unallocated_amount shifts by the same delta as the amount edit; can't be reduced below the already-allocated portion
- client_refund linked to a ticket (via ticket_payments): amount edit is delta-based — the delta shifts the ticket_payments row's allocated_amount, the ticket's amount_paid (opposite direction) and refund_paid (same direction), and recomputes payment_status/refund_status via deriveRefundStatus; blocked if it would drive amount_paid or refund_paid negative
- supplier_refund linked to a ticket (via payments.ticket_id): amount edit is delta-based — the delta shifts the ticket's refund_received and recomputes refund_status via deriveRefundStatus; blocked if it would drive refund_received negative
- Editing a ticket's refund_received/refund_paid directly (RefundModal's "Edit Refund Received"/"Edit Refund Paid" row actions) is a blunt override of the running total — it does NOT reverse-sync the individual payments/ticket_payments rows that fed into it (there's no reliable way to redistribute a single overridden total back across multiple prior receipts). Use it only to correct the running total itself, not to edit an individual receipt — edit the individual payment via ViewPaymentModal for that

### Deleting a Logged Payment (Payments Page)
- Every row can be deleted, regardless of type. Reverses the payment's effect before removing it — see "Payments Page — Delete Action" in design.md for the exact per-type reversal rules
- Reversal branches on ticket_payments.type (not payments.type), since one payment can span ticket_payments rows of different types
- All reversals floor at 0 — if a running total was already lowered below what this payment contributed, the reversal clamps rather than going negative, and the confirm dialog warns when this will happen
- Not wrapped in a DB transaction — a failure partway through a multi-ticket reversal can leave it partially reversed, same limitation as everywhere else in this codebase

### Forward to Supplier (Passthrough Payment)
- When logging a client payment, agent can optionally forward all or part to a supplier in the same action
- System creates two separate payment rows — one client_payment, one supplier_payment
- Both rows are independent for calculation purposes
- Client payment allocated to tickets via ticket_payments as normal
- Supplier payment allocated to same or different tickets via ticket_payments
- If forward amount differs from client payment — agent enters custom supplier amount

payments rows created on forward:
  Row 1: type=client_payment, client_id=X, amount=300,000
  Row 2: type=supplier_payment, supplier_id=Y, amount=285,000 (or custom amount)

### Supplier Payment Flow
- Same junction table model, reversed
- Agent pays supplier — logs against supplier_id
- Allocated to tickets to mark supplier contribution per ticket
- ticket_payments.type = supplier for these rows

### Scale and Performance
- Expected rows in ticket_payments: ~4,800/year per agent
- Each row ~100 bytes — negligible storage
- All queries use indexed lookups on payment_id and ticket_id
- Junction table is standard relational practice used at scale by Shopify, Uber, banking systems
- Never use JSON columns to store ticket ID arrays — breaks indexing, foreign keys, and aggregations

## Refund Architecture

### Refund Types
- Type 1: Full refund no penalty — supplier refunds full purchase price, agent refunds full sell price
- Type 2: Partial refund with penalty — supplier refunds less due to airline penalty, agent decides how much to pass to client
- Type 3: Void — ticket cancelled, may or may not have money exchanged

### Cumulative Tracking Model
refund_receivable/refund_payable are the agreed TARGETS, set once via Initiate/Edit Refund Terms. refund_received/refund_paid are cumulative running ACTUALS — every recording action adds to them rather than overwriting, so a refund can be settled across multiple partial receipts/payments on either side, independently, in any order. refund_status is derived (never manually set past initiation) by `deriveRefundStatus` (`src/lib/refunds.js`), shared by every write path (RefundModal, LogTransactionModal, AllocationModal, SupplierAllocationModal, ViewPaymentModal):
  - supplierDone = receivable is null, OR received >= receivable
  - clientDone = payable is null, OR paid >= payable
  - both done → closed; only supplier done → supplier_refunded; only client done → client_refunded; neither → initiated
  - A side with no agreed target (null) is trivially treated as done, since there's nothing to collect/pay on it

### Recording a Refund — Real Payments
Every refund recording action creates a real, channel-tracked payment row (not just a field update on the ticket), so refunds show up correctly in Payments page totals and channel balances:
- Supplier side: RefundModal's "Record Supplier Refund" (or LogTransactionModal's Supplier Refund) inserts a payments row (type=supplier_refund, payments.ticket_id set), then adds the amount to refund_received and recomputes refund_status
- Client side: RefundModal's "Record Client Refund" (or LogTransactionModal's Client Refund) inserts a payments row (type=client_refund) + a ticket_payments row (type=client_refund, negative allocated_amount), then adds the amount to refund_paid, subtracts it from amount_paid (floored at 0), and recomputes payment_status/refund_status
- Both sides can also be settled by netting against an unrelated bulk payment via AllocationModal/SupplierAllocationModal (see "Refund-Aware Allocation" below) instead of a standalone refund receipt
- "Edit Refund Received"/"Edit Refund Paid" row actions are a blunt override of the running total — for correcting the total itself, not for editing an individual receipt (see "Editing a Logged Payment")

### Refund Flow
1. Agent marks ticket as refund initiated
2. Enters refund_receivable (expected from supplier) and refund_payable (agreed with client)
3. Supplier sends money, one or more times — refund_received accumulates; refund_status recomputes to supplier_refunded once it meets refund_receivable
4. Agent pays client, one or more times — refund_paid accumulates; refund_status recomputes to client_refunded once it meets refund_payable
5. Both sides settled (or one/both sides has no target at all) — refund_status → closed
6. refund_margin auto-calculated at all times = refund_received - refund_payable
7. Agent can refund client before receiving from supplier, and either side can be a partial/multi-installment settlement — the two sides are tracked and derived fully independently
8. Row actions for recording supplier/client refunds stay available for as long as refund_status is set and not closed — not gated on the other side, and not gated on this side already having some progress (label switches from "Record ..." to "Add ..." once there's existing progress on that side)

### Refund-Aware Allocation (Netting)
AllocationModal (client bulk payments) and SupplierAllocationModal (supplier bulk payments) both treat a ticket with an open refund as a second kind of allocation target, alongside the normal outstanding fare/purchase price:
- Client side: an incoming bulk client payment can be partly allocated against a DIFFERENT ticket's refund_payable instead of a fare — e.g. the client sends one lump sum that covers a new ticket's fare while implicitly netting off a refund owed to them on an older ticket. Inserts a ticket_payments row (type=client_refund, negative allocated_amount) against the refund ticket, adds to its refund_paid, subtracts from its amount_paid, recomputes both statuses
- Supplier side: an outgoing bulk supplier payment can be partly allocated against a different ticket's refund_receivable instead of a purchase price — e.g. paying a supplier for new tickets while netting off a refund they owe on a voided ticket instead of collecting it separately. Inserts a ticket_payments row (type=supplier_refund, negative allocated_amount) against the refund ticket, adds to its refund_received, recomputes refund_status
- "Distribute Evenly" mode only considers fare-kind tickets (an even split across a mix of fare/refund purposes isn't a meaningful default); "Select Tickets" mode shows both kinds with a Purpose badge ("Fare" / "Refund owed")

### Void Flow
- Agent marks ticket as void — status → void, is_void = true
- Ticket stays in system for audit trail — never deleted
- If client had paid — refund flow still applies (Type 2, partial refund with penalty, covers a supplier penalty / reduced client refund on an already-paid ticket)
- If no money exchanged — ticket sits as void record with zero margin impact, unless...
- Cancellation fees (VoidConfirmModal): optional, entered on the void action itself — a supplier fee charged to the agent, and/or a fee the agent charges the client for handling the cancellation. Independent of the refund flow — this is for a ticket that was never actually paid/purchased for real money, just a standalone administrative charge tied to voiding it. Both optional, blank by default.
  - void_fee_paid stored on the ticket; if > 0, also creates a real supplier_payment row (channel-tracked) linked via a ticket_payments row with type=void_fee_supplier
  - void_fee_collected stored on the ticket; if > 0, also creates a real client_payment row (channel-tracked) linked via a ticket_payments row with type=void_fee_client
  - Both ticket_payments types are deliberately distinct from type=client/supplier — they're excluded from the amount_paid/supplierAmountPaid derivation (that SUM only counts type=client/supplier), since these fees aren't paying down the original sell_price/purchase_price
  - Requires the ticket to actually have a client_id/supplier_id linked before that side's fee can be entered
  - void_fee_margin = void_fee_collected - void_fee_paid, folded into net_margin (see Margin Calculations)

## Reissue Architecture

### Core Concept
A reissue creates a new child ticket linked to the original parent ticket via parent_ticket_id. The original ticket stays intact with its original values and status changes to reissued.

### Reissue Pricing Model
The child ticket's sell_price and purchase_price represent the FULL new prices, not incremental amounts:
- child.sell_price = original_sell_price + fare_difference + reissue_fee_collected
- child.purchase_price = original_purchase_price + fare_difference + reissue_fee_paid

The ReissueModal auto-computes these values as the agent types the reissue fee and fare difference fields. sell_price and purchase_price on the child are read-only computed displays — not manually editable.

### Reissue Fields on Child Ticket
- parent_ticket_id — FK to original ticket
- is_reissue = true
- reissue_fee_collected — fee collected from client (stored for reference; baked into sell_price)
- reissue_fee_paid — fee paid to supplier (stored for reference; baked into purchase_price)
- fare_difference — price difference (positive or negative; baked into both prices)

### Reissue Flow
1. Agent clicks Reissue on original ticket row
2. Modal opens pre-filled with original ticket data
3. Agent updates ticket details — carrier, PNR, ticket number, dates
4. Agent enters fare_difference, reissue_fee_collected, reissue_fee_paid
5. sell_price and purchase_price auto-compute live from original prices + entered values
6. "Profit From Reissue" (= reissue_fee_collected - reissue_fee_paid) shown as a live display
7. On save — original ticket status → reissued, new child ticket created with computed prices

### Chain Margin
- Displayed on ticket detail view — not list view
- Shows original ticket margin + all child reissue margins
- chain_net_margin = SUM(net_margin) across parent and all children

## Document Storage

### entity_documents Table
Stores metadata for documents uploaded against clients and suppliers.

entity_documents:
  id (uuid, PK)
  agent_id (uuid, FK to agents)
  entity_type: 'client' | 'supplier'
  entity_id (uuid — references clients.id or suppliers.id)
  doc_type: 'Business Card' | 'NID' | 'Passport' | 'Photo' | 'Others'
  file_name (text — original filename)
  storage_path (text — path in Supabase Storage bucket)
  created_at

RLS policy: agent can only access rows where agent_id matches their own agents.id.

### Supabase Storage
- Bucket: `documents` (private)
- Path format: `{agent_id}/{entity_type}/{entity_id}/{uuid}.{ext}`
- Access via signed URLs (1-hour expiry) — generated on demand when agent opens a file
- Maximum 5 documents per entity (enforced in UI, not DB)

## Row Level Actions on Ticket List

### Visibility rules (evaluated independently per action, not per status)
- Void: status is not void, not reissued, refund_status is not closed
- Refund: status is not void, not reissued, refund_status is null
- Reissue: status is not void, not reissued, refund_status is not initiated
- Record Payment: payment_status is not paid and status is not void
- Record/Add Supplier Refund: refund_status is set and not closed (available repeatedly regardless of existing progress on either side — label switches to "Add ..." once refund_received > 0)
- Record/Add Client Refund: refund_status is set and not closed (available repeatedly regardless of existing progress on either side — label switches to "Add ..." once refund_paid > 0)
- View: always shown
- Edit and Delete remain available on every row alongside the contextual actions above
- Actions are grouped behind a row-level hamburger menu (not inline buttons)

### Ticket Chips on List
- Chips are computed, sentence-case badges (not bracketed status tags), shown via small pills:
  - Payment: Unpaid (red), Partial (yellow), Paid (green)
  - Flight: Upcoming (blue), Flying today (purple), Return pending (orange), Flown (gray)
  - Lifecycle: Void (gray), Reissued (orange, on the parent), Reissue (blue, on the child), Refund (yellow, refund_status = initiated), Refunded (red, refund_status = closed)
- A ticket can show multiple chips at once (e.g. Partial + Upcoming + Reissue)

## Rules
- Always filter by agent_id when querying any table
- Get agent_id from the agents table using auth.uid() = user_id
- Never hardcode agent_id
- Always use the useAuth hook to get the current agent object
- agent.id is the agent_id to use in all queries
- Never link payments directly to tickets — always go through ticket_payments
- unallocated_amount must always be >= 0
- payment_status on tickets must always reflect actual SUM of ticket_payments allocations
- A ticket can have multiple payment_ids — report all of them, no single owner
- Never use reported_price — removed from data model
- Never use net column — removed from data model
- office_markup is never factored into payment, refund, or balance calculations
- Void tickets are never deleted — always kept for audit
- Reissued parent tickets are never deleted or modified — child ticket carries forward
- reissue_fee fields are stored on child tickets for reference but are already baked into sell_price/purchase_price — never add them separately to margin calculations
