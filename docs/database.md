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
- refund_payable — how much you're liable to hand the client back, not a discount/target amount. 0 (or unset) = non-refundable, client still owes the full remaining sell_price. Equal to sell_price = full forgiveness. See "Client Net Position" under Refund Architecture for how this nets against amount_paid
- refund_paid — actual refund paid to client
- refund_notes — free-text note entered when initiating a refund (own column, not appended to narration)

## Margin Calculations

### Per Ticket
- ticket_margin = sell_price - purchase_price
- refund_margin = refund_receivable - refund_payable — booked/agreed basis, matching ticket_margin's own accrual nature (sell_price/purchase_price are booked values too, not amounts actually collected/paid). Uses refund_receivable (what the supplier agreed to), not refund_received (what's actually landed so far) — otherwise net_margin would fluctuate purely with how far supplier-side collection has progressed rather than reflecting the deal's real economics, even though the agreed terms haven't changed
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
- Open Refunds / Awaiting From Supplier / Owed To Clients — the refund lifecycle has 4 states (initiated -> supplier_refunded or client_refunded, whichever side settles first -> closed), derived by comparing cumulative actuals against agreed targets (see deriveRefundStatus in "Refund Architecture"). Awaiting From Supplier sums the actual remaining balance per ticket (`max(receivable - received, 0)`), not an all-or-nothing null check, so a partial receipt still counts toward what's left. Owed To Clients sums `clientOwedBack` per ticket (the negative side of the client net position — see "Client Net Position"), not `refund_payable - refund_paid` directly, since that ignores whether the client had actually paid anything toward the ticket in the first place. Refund Net Margin only counts refund_status = closed (fully settled on both sides)

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
- **Outstanding eligibility**: client-side and supplier-side outstanding are no longer symmetric here.
  - Client side (Dashboard's Collection Pending, Client Detail's Outstanding Balance, the Outstanding column on Tickets/Client Detail tables): every non-void ticket contributes `clientOutstanding(ticket)` (see "Client Net Position" under Refund Architecture) — this nets `refund_payable` against `sell_price`/`amount_paid` rather than excluding a refund-active ticket outright, since the client may still owe a reduced amount (e.g. a cancellation fee on a credit booking that hadn't been paid yet) even after a refund is initiated. It degrades to the ordinary `sell_price - amount_paid` for a ticket with no refund at all (`refund_payable` is null there).
  - Supplier side (Dashboard's Total Payable to Suppliers, Supplier Detail's Outstanding Payable): still excluded entirely once a ticket has any refund activity (`!is_void && refund_status == null`), unchanged. Once you've already paid the supplier and a refund starts, the remaining purchase_price obligation is extinguished, not reduced to a new target — a reduced bill on a not-yet-paid ticket is a void fee, not a refund (see Void Flow).

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
7. Record Payment (ticket row action) follows the same rule even though it targets one specific ticket: the amount typed is capped at that ticket's outstanding — only the capped portion is allocated and added to amount_paid, and any excess is left as unallocated_amount on the payment row, which immediately triggers the same AllocationModal used everywhere else so the excess can be distributed across the client's other tickets or left as credit. Prevents silently overpaying one ticket with no trace of where the extra went

### Inline Payment (Ticket Form)
- Collapsible optional section at bottom of ticket modal
- Works for all ticket types — walk-in passenger or trade client
- If filled: creates payment row + ticket_payments allocation row on ticket save, then updates the ticket's own amount_paid/payment_status (additively — `(current amount_paid ?? 0) + this amount`, so re-using the section on an edit to log a further payment adds to the running total rather than overwriting it). Target is clientEffectiveTarget (sell_price, reduced by refund_payable if a refund happens to be active), matching every other payment-recording surface
- If left empty: ticket saves with payment_status = unpaid
- Paid in full checkbox disables the amount field and live-reflects the current sell_price; on save, uses the actual sell_price value
- Same pattern and fix applies to ReissueModal's inline client payment on the new child ticket (also sets unallocated_amount = 0 on the payment row, not the full amount — the full amount is allocated to the child ticket in the same action, so nothing should be left showing as unallocated)

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

### Deleting a Logged Payment (Payments Page, Client Detail, Supplier Detail)
- Every row can be deleted, regardless of type, from the Payments page; Client Detail and Supplier Detail's Payment History tabs also have a Delete action (scoped to client_payment / supplier_payment rows respectively). All three share the same reversal logic — `src/lib/paymentReversal.js` (`reverseTicketPaymentRow`, `reverseStandaloneSupplierRefund`, `TICKET_REVERSAL_FIELDS`) — rather than each page reimplementing it, since a second independent copy is exactly the kind of split-brain gap that's bitten this codebase before. See "Deleting a Payment" in design.md for the exact per-type reversal rules
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
refund_receivable/refund_payable are the agreed TARGETS, set once via Initiate/Edit Refund Terms. refund_received is a cumulative running ACTUAL on the supplier side — every recording action adds to it rather than overwriting, so a supplier-side recovery can happen across multiple partial receipts. The client side works differently — see "Client Net Position" below; refund_paid still exists as a cumulative cash-handed-back audit counter, but it is not what determines whether the client side is settled.

refund_status is derived (never manually set past initiation) by `deriveRefundStatus` (`src/lib/refunds.js`), shared by every write path (RefundModal, LogTransactionModal, AllocationModal, SupplierAllocationModal, ViewPaymentModal, RecordPaymentModal):
  - supplierDone = receivable is null, OR received >= receivable
  - clientDone = clientRefundNet(ticket) === 0 (see below) — i.e. sell_price - amount_paid - refund_payable === 0
  - both done → closed; only supplier done → supplier_refunded; only client done → client_refunded; neither → initiated

### Client Net Position
The common failure mode this fixes: a client who booked on credit (hasn't paid anything yet) and cancels doesn't get cash "refunded" — they simply owe less than the original sell_price. The old model only recognized cash flowing back to the client (refund_paid catching up to refund_payable), so this case could never settle. The fix treats refund_payable as "how much I'm liable to hand back" (its actual current meaning), and nets it against what's already been paid — which correctly covers both directions from a single number, in `src/lib/refunds.js`:

```
clientRefundNet(ticket) = sell_price - amount_paid - (refund_payable ?? 0)

net > 0  →  client still owes net           → clientOutstanding(ticket), collected via a normal Record Payment
net < 0  →  you owe the client |net| back   → clientOwedBack(ticket), settled via Record Client Refund
net = 0  →  settled — refund_status can reach client_refunded/closed
```

refund_payable itself never changes meaning — 0 (or unset) is a non-refundable ticket (client still owes the full remaining sell_price), equal to sell_price is full forgiveness, anything between is a partial discount/fee, and anything combined with a real prior payment (amount_paid > 0) can produce a genuine cash-back liability exactly like before. `clientEffectiveTarget(ticket) = sell_price - refund_payable` is what RecordPaymentModal collects toward once a refund is active, instead of the stale full sell_price.

### Recording a Refund — Real Payments
Every refund recording action creates a real, channel-tracked payment row (not just a field update on the ticket), so refunds show up correctly in Payments page totals and channel balances:
- Supplier side: RefundModal's "Record Supplier Refund" (or LogTransactionModal's Supplier Refund) inserts a payments row (type=supplier_refund, payments.ticket_id set), then adds the amount to refund_received and recomputes refund_status
- Client side, cash back (client had already paid more than the new net target): RefundModal's "Record Client Refund" (or LogTransactionModal's Client Refund) inserts a payments row (type=client_refund) + a ticket_payments row (type=client_refund, negative allocated_amount), then adds the amount to refund_paid, subtracts it from amount_paid (floored at 0), and recomputes payment_status/refund_status
- Client side, still owes (a credit booking, or a partial payment below the new net target): settled via the ordinary "Record Payment" action, same as any other ticket — RecordPaymentModal targets `clientEffectiveTarget(ticket)` instead of raw sell_price once a refund is active, and recomputes refund_status the same way
- Both sides can also be settled by netting against an unrelated bulk payment via AllocationModal/SupplierAllocationModal (see "Refund-Aware Allocation" below) instead of a standalone refund receipt
- "Edit Refund Received"/"Edit Refund Paid" row actions are a blunt override of the running total — for correcting the total itself, not for editing an individual receipt (see "Editing a Logged Payment")

### Refund Flow
1. Agent marks ticket as refund initiated
2. Enters refund_receivable (expected from supplier) and refund_payable (how much you're liable to hand the client back — see "Client Net Position")
3. Supplier sends money, one or more times — refund_received accumulates; refund_status recomputes to supplier_refunded once it meets refund_receivable
4. Client side settles either direction: if the client had already paid more than the new net target, you hand cash back via Record Client Refund; if they still owe (most commonly a credit booking that hadn't been paid at all), they pay the reduced amount via a normal Record Payment. refund_status recomputes to client_refunded once `clientRefundNet(ticket) === 0`, regardless of which direction settled it
5. Both sides settled (or one/both sides has no target at all) — refund_status → closed
6. refund_margin auto-calculated at all times = refund_receivable - refund_payable (see "Margin Calculations" — booked/agreed basis, not tied to how much has actually landed from the supplier yet)
7. Agent can settle the client side before the supplier side, and either side can be a partial/multi-installment settlement — the two sides are tracked and derived fully independently
8. Row actions for recording supplier/client refunds stay available for as long as refund_status is set and not closed — not gated on the other side, and not gated on this side already having some progress (label switches from "Record ..." to "Add ..." once there's existing progress on that side)

### Refund-Aware Allocation (Netting)
AllocationModal (client bulk payments) and SupplierAllocationModal (supplier bulk payments) both treat a ticket with an open refund as a second kind of allocation target, alongside the normal outstanding fare/purchase price:
- Client side: an incoming bulk client payment can be partly allocated against a DIFFERENT ticket's outstanding cash-back liability instead of a fare — e.g. the client sends one lump sum that covers a new ticket's fare while implicitly netting off a refund owed to them on an older ticket. Eligibility and the capped amount both come from `clientOwedBack(ticket)` (see "Client Net Position"), not `refund_payable - refund_paid` directly, for the same reason Owed to Clients does — a ticket only belongs here if it actually owes cash back net of what's been paid. Inserts a ticket_payments row (type=client_refund, negative allocated_amount) against the refund ticket, adds to its refund_paid, subtracts from its amount_paid, recomputes both statuses
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
The child ticket's sell_price and purchase_price are INCREMENTAL — just what this specific reissue event is worth, not the original ticket's price rolled forward:
- child.sell_price = fare_difference + reissue_fee_collected
- child.purchase_price = fare_difference + reissue_fee_paid

Each reissue is its own small, fully independent, auditable ticket row — its own sell_price, its own outstanding (sell_price - amount_paid - refund_payable), its own margin (sell_price - purchase_price, which reduces to reissue_fee_collected - reissue_fee_paid since fare_difference nets to zero margin impact). The parent ticket is untouched by the reissue — it keeps its full original sell_price/purchase_price permanently, in whatever period it was originally booked in, regardless of how many times it's later reissued. This is deliberate: a reissue happening in a later month must never retroactively change an earlier month's already-reported numbers, and the reissue's own fee must be tagged to the month it actually happened in — not smeared across both.

Previously (pre-fix) these were cumulative — child.sell_price = original_sell_price + fare_difference + reissue_fee_collected — which double-counted the original sale every time a ticket was reissued (it landed in both the original ticket's period, via the untouched parent, and again in the reissue's period, baked into the child's inflated cumulative price) and made "Total Sales"/margin figures retroactively change every time a later reissue happened. Existing reissued tickets created before this fix are still stored under the old cumulative meaning and need a one-time data correction if/when migrated:
```sql
UPDATE tickets
SET sell_price = COALESCE(fare_difference, 0) + COALESCE(reissue_fee_collected, 0),
    purchase_price = COALESCE(fare_difference, 0) + COALESCE(reissue_fee_paid, 0)
WHERE is_reissue = true
```

The ReissueModal auto-computes these values as the agent types the reissue fee and fare difference fields. sell_price and purchase_price on the child are read-only computed displays — not manually editable. A separate reference-only "new ticket total" line (original + fare_difference + reissue_fee_collected) is shown alongside for the agent's convenience, so they can still see the cumulative picture — it is never stored anywhere.

gds_price (Supplier Purchase Price) on a reissue child starts blank, not pre-filled from the parent — it's this reissue's own informational supplier cost, not the whole ticket's.

No chain-level rollup UI exists yet (e.g. a single number showing the sum across an original ticket and all its reissues) — an agent auditing the full lifetime value of a repeatedly-reissued ticket currently has to open each ticket in the chain individually via the parent/child links on the Ticket Detail view.

### Reissue Fields on Child Ticket
- parent_ticket_id — FK to original ticket
- is_reissue = true
- reissue_fee_collected — fee collected from client; baked into this reissue's own sell_price
- reissue_fee_paid — fee paid to supplier; baked into this reissue's own purchase_price
- fare_difference — price difference (positive or negative); baked into both prices, nets to zero margin impact

### Reissue Flow
1. Agent clicks Reissue on original ticket row
2. Modal opens pre-filled with original ticket data (passenger, route, dates — not price). Carrier, client, and supplier are carried over silently, not shown for re-selection — the modal only exposes fields that plausibly change on a reissue (passenger name, ticket number, PNR, route, dates)
3. Agent updates PNR/ticket number/dates as needed
4. Agent enters fare_difference, reissue_fee_collected, reissue_fee_paid
5. sell_price and purchase_price auto-compute live as just those entered values (fare_difference + fee) — not added to the original ticket's price
6. "Profit From Reissue" (= reissue_fee_collected - reissue_fee_paid) shown as a live display
7. On save — original ticket status → reissued, new child ticket created with computed prices. No payment is recorded as part of this flow — use the normal Record Payment row action on the new ticket afterward if needed

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
- Cancel Refund: refund_status is set (any state, including closed). Checks for real payments recorded against the ticket first — any payments row (type=supplier_refund, ticket_id=this ticket) or ticket_payments row (type=client_refund or supplier_refund, ticket_id=this ticket). If any exist, blocked with an error asking to delete those payments first (via the ticket's payment history or the Payments page — see "Deleting a Logged Payment", which already reverses their effect correctly). If none exist, wipes the ticket back to its pre-refund state: refund_status, refund_receivable, refund_received, refund_payable, refund_paid, refund_notes all set to null — indistinguishable from a ticket that never had a refund initiated. A blunt "Edit Refund Received/Paid" override alone (no real payment behind it) doesn't block this — those numbers just get wiped along with everything else
- View: always shown
- Edit and Delete remain available on every row alongside the contextual actions above
- Actions are grouped behind a row-level hamburger menu (not inline buttons)

### Ticket Chips on List
- Chips are computed, sentence-case badges (not bracketed status tags), shown via small pills:
  - Payment: Unpaid (red), Partial (yellow), Paid (green)
  - Flight: Upcoming (blue), Flying today (purple), Return pending (orange), Flown (gray)
  - Lifecycle: Void (gray), Reissued (orange, on the parent), Reissue (blue, on the child), Refund (yellow, refund_status is set and not closed — covers initiated/supplier_refunded/client_refunded as one chip, since all three are "still in progress" from the agent's point of view), Refunded (red, refund_status = closed)
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
