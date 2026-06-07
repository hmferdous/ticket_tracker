# Database Rules

## Stack
Supabase (Postgres) hosted at ap-south-1 Mumbai
All tables have Row Level Security (RLS) enabled
Never disable RLS on any table

## Tables
- `agents` — one row per user. Links to auth.users via user_id. Contains plan, trial_ends_at, is_admin
- `clients` — belongs to agent via agent_id. Covers both trade clients (bulk buyers, ongoing relationship) and retail/walk-in passengers (one-off buyers). No toggle to distinguish — behaviour is determined by usage pattern.
- `suppliers` — belongs to agent via agent_id
- `tickets` — core table. belongs to agent. links to client and supplier. supports parent/child relationship for reissues.
- `payments` — one row per payment event. Linked to client or supplier. Never linked directly to tickets.
- `ticket_payments` — junction table. Links payments to tickets with allocated amounts. One row per ticket per payment. Standard relational many-to-many pattern.
- `reminders` — email reminder rules per ticket

## Key Fields on Tickets
- purchase_price — total cost to agent. Mandatory. Used for all calculations (margin, payments, refunds).
- gds_price — optional. Raw airline/GDS cost before company markup. Label in form: Supplier Purchase Price. Informational only — no effect on any calculation. Pro plan feature (gated later).
- office_markup — auto-calculated on save as purchase_price - gds_price. Never entered in form. Stored silently. Used only for dashboard reporting of company contribution. Null if gds_price not entered.
- sell_price — actual price charged to client (real number, private)
- issue_date — optional. Date the ticket was issued.
- amount_paid — derived from SUM(ticket_payments.allocated_amount) for this ticket
- payment_status — unpaid, partial, paid (derived from amount_paid vs sell_price)
- status — booked, collected, supplier_paid, flown, closed, reissued, void
- refund_status — null, initiated, supplier_refunded, client_refunded, closed
- parent_ticket_id — nullable FK to tickets.id. Set when this ticket is a reissue of another.
- is_reissue — boolean. true if this ticket was created as a reissue of another ticket.
- is_void — boolean. true if ticket was voided.
- reissue_fee_collected — amount collected from client for reissue
- reissue_fee_paid — amount paid to supplier for reissue
- fare_difference — price difference between old and new ticket on reissue (can be negative)
- refund_receivable — expected refund amount from supplier
- refund_received — actual refund received from supplier
- refund_payable — agreed refund amount to pay client
- refund_paid — actual refund paid to client

## Margin Calculations

### Per Ticket
- ticket_margin = sell_price - purchase_price
- refund_margin = refund_received - refund_payable
- reissue_margin = reissue_fee_collected - reissue_fee_paid + fare_difference
- net_margin = ticket_margin + refund_margin + reissue_margin

### Chain Margin (parent + all reissued children)
- chain_net_margin = SUM(net_margin) across parent ticket and all tickets where parent_ticket_id = parent.id

### Dashboard Reporting
- Total actual margin = SUM(net_margin) across all tickets in period
- Total office markup contributed = SUM(office_markup) across all tickets in period

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
  type: client_payment | supplier_payment | client_refund | supplier_refund
  amount — total payment amount
  unallocated_amount — starts equal to amount, reduces as allocations are made, never goes below 0
  channel — cash, bkash, bank, office, ebl, dbbl, ibbl, city, brac, ucb
  trx_id, notes, payment_date, created_at

ticket_payments:
  id, payment_id, ticket_id
  allocated_amount — amount from this payment applied to this ticket
  type: client | supplier (to distinguish which side is being allocated)
  created_at

### Balance Calculations
- Client total billed = SUM(tickets.sell_price) for all tickets belonging to that client
- Client total received = SUM(payments.amount) for all client_payments for that client
- Client balance outstanding = total billed - total received
- Ticket amount paid = SUM(ticket_payments.allocated_amount) for that ticket where type = client
- Ticket outstanding = sell_price - ticket amount paid
- Unallocated credit on client = SUM(payments.unallocated_amount) for that client

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
- Paid in full checkbox auto-fills amount = sell_price

### Forward to Supplier (Passthrough Payment)
- When logging a client payment, agent can optionally forward all or part to a supplier in the same action
- System creates two separate payment rows — one client_payment, one supplier_payment
- Both rows are independent for calculation purposes
- Client payment allocated to tickets via ticket_payments as normal
- Supplier payment allocated to same or different tickets via ticket_payments
- If forward amount differs from client payment — agent enters custom supplier amount
- Difference surfaces naturally in margin calculations

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

### Refund Flow
1. Agent marks ticket as refund initiated
2. Enters refund_receivable (expected from supplier) and refund_payable (agreed with client)
3. When supplier sends money — logs refund_received, status → supplier_refunded
4. When agent pays client — logs refund_paid, status → client_refunded
5. Both sides settled — status → closed
6. refund_margin auto-calculated at all times = refund_received - refund_payable
7. Agent can refund client before receiving from supplier — system tracks both sides independently

### Void Flow
- Agent marks ticket as void — status → void, is_void = true
- Ticket stays in system for audit trail — never deleted
- If client had paid — refund flow still applies
- If no money exchanged — ticket sits as void record with zero margin impact

## Reissue Architecture

### Core Concept
A reissue creates a new child ticket linked to the original parent ticket via parent_ticket_id. The original ticket stays intact with its original values and status changes to reissued.

### Reissue Fields on Child Ticket
- parent_ticket_id — FK to original ticket
- is_reissue = true
- reissue_fee_collected — fee collected from client
- reissue_fee_paid — fee paid to supplier
- fare_difference — price difference (positive or negative)
- reissue_margin = reissue_fee_collected - reissue_fee_paid + fare_difference

### Reissue Flow
1. Agent clicks Reissue on original ticket row
2. Modal opens pre-filled with original ticket data
3. Agent updates new ticket details — carrier, PNR, ticket number, dates, prices
4. Agent enters reissue fees and fare difference
5. On save — original ticket status → reissued, new child ticket created
6. Payment on original ticket carries forward — child ticket starts with payment inherited from parent
7. Any additional payment for fare difference logged separately

### Chain Margin
- Displayed on ticket detail view — not list view
- Shows original ticket margin + all child reissue margins
- chain_net_margin = SUM(net_margin) across parent and all children

## Row Level Actions on Ticket List

### Available actions per status
- booked: Edit, Reissue, Void, Record Payment, View
- collected: Edit, Reissue, Void, View
- supplier_paid: Reissue, Void, View
- flown: View only
- refund_initiated: Record Refund Received, Record Refund Paid, View
- void: View only
- reissued: View, link to child ticket

### Ticket Tags on List
- Normal ticket — no tag
- Reissued parent — [REISSUED] orange tag, clickable to child
- Reissue child — [REISSUE OF #ID] blue tag, clickable to parent
- Void — [VOID] gray tag
- Refund initiated — [REFUND] yellow tag
- Fully refunded — [REFUNDED] red tag

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
