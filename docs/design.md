# Design Rules

## Stack
React + Vite
Tailwind CSS via @tailwindcss/vite plugin
No component library — build clean custom components
jsPDF + jspdf-autotable for PDF generation (ledger reports)

## Style Guidelines
- Clean, professional, minimal
- Primary color: blue (blue-600 for buttons, blue-50 for highlights)
- Use white cards with subtle shadows for content areas
- Mobile friendly but desktop first
- Sidebar navigation for main app
- Modals for add/edit forms

## Layout
- Authenticated pages: sidebar on left, content on right
- Sidebar links: Dashboard, Tickets, Clients, Suppliers, Payments, Reports (collapsible group), Settings
- Reports group expands/collapses on click; auto-expands when any /reports/* route is active
- Reports sub-links: Client Ledger, Supplier Ledger, Channel Ledger
- Admin pages: separate layout with admin sidebar

## AppLayout Actions Slot
- AppLayout accepts an `actions` prop rendered as a flex row in the page header (top right)
- Used for page-level primary actions: "+ Add ticket", "+ Log Transaction", "View Ledger", "Hide/Show amounts", etc.
- Pattern: `<AppLayout title="Page Title" actions={<button>...</button>}>`

## Components
- Reusable UI components go in src/components/ui/
- Feature components go in their respective folder (tickets, clients, suppliers, payments)
- Pages go in src/pages/agent/ for agent facing
- Pages go in src/pages/admin/ for admin facing
- Report pages go in src/pages/agent/reports/

## Forms
- Always show validation errors inline
- Show loading state on submit buttons
- Show success/error toast or message after save

## Ticket Form Fields
- Purchase Price — mandatory. Label: Purchase Price. Used for all calculations. Maps to purchase_price.
- Supplier Purchase Price — optional. Label: Supplier Purchase Price. Maps to gds_price. Informational only. Pro plan feature — gated later. Shown below Purchase Price.
- Office Markup — never shown in form. Auto-calculated on save: purchase_price - gds_price. Only calculated if gds_price is entered.
- Sell Price — mandatory. Label: Sell Price.
- Issue Date — optional date field. Label: Issue Date. Maps to issue_date.

## Ticket Form — Payment Sections
Two separate collapsible sections, both collapsed by default, both optional:

Section 1 — Client Payment:
  - Amount Received (numeric) — disabled and live-reflects sell_price when Paid in full is checked
  - Payment Channel (dropdown: Cash, bKash, Bank, Office, EBL, DBBL, IBBL, City, BRAC, UCB)
  - Transaction ID (text)
  - Notes (text)
  - Paid in full checkbox — disables Amount field and uses sell_price on save (dynamic, not a one-time copy)

Section 2 — Supplier Payment:
  - Amount Paid (numeric) — disabled and live-reflects purchase_price when Paid in full is checked
  - Payment Channel (same dropdown)
  - Transaction ID (text)
  - Notes (text)
  - Paid in full checkbox — disables Amount field and uses purchase_price on save

On save:
  - If Client Payment amount > 0: create payment row (type: client_payment) + ticket_payments allocation row
  - If Supplier Payment amount > 0: create payment row (type: supplier_payment) + ticket_payments allocation row
  - Both are independent transactions
  - gds_price saved to tickets table if entered
  - office_markup = purchase_price - gds_price saved silently if gds_price entered, otherwise null

## Plan Gating (future)
- Supplier Purchase Price field hidden for non-pro users
- Office markup dashboard section hidden for non-pro users

## Ticket List
- Single flat list — no separate tabs for reissues, voids, refunds
- Sorted by issue_date descending (latest first); tickets without issue_date fall to the bottom
- Issue Date is the first column, followed by Travel Date, then Passenger, Route, etc.
- Computed sentence-case chip badges per ticket (small pills, not bracketed tags), multiple can show at once:
  - Payment: Unpaid (red), Partial (yellow), Paid (green)
  - Flight: Upcoming (blue), Flying today (purple), Return pending (orange), Flown (gray)
  - Lifecycle: Void (gray), Reissued (orange, on parent), Reissue (blue, on child), Refund (yellow, refund initiated), Refunded (red, refund closed)
- Outstanding amount shown per ticket row

## Row Level Actions on Ticket List
- Actions are grouped behind a hamburger-menu button per row (not inline buttons) — opens a dropdown, closes on outside click
- Edit, Delete, and View are always present in the menu
- Contextual actions are shown/hidden per-action based on ticket state, not a fixed per-status table:
  - Void: status not void, not reissued, refund_status not closed
  - Refund: status not void, not reissued, refund_status is null
  - Reissue: status not void, not reissued, refund_status not initiated
  - Record Payment: payment_status not paid and status not void
  - Record Supplier Refund / Record Client Refund: shown once a refund is initiated, independently per side (whichever of refund_received / refund_paid is still null)
  - Edit Refund Terms: shown whenever a refund exists (refund_status not null), including after settlement
  - Edit Refund Received / Edit Refund Paid: shown per side once that side's actual amount has been recorded, for correcting typos
  - Edit Reissue Details: shown on reissue child tickets (is_reissue = true), not void
- Actions that aren't applicable are omitted from the menu entirely, never shown disabled
- Suppliers list also uses the same hamburger-menu pattern for row actions

## Reissue Modal
- Opens from row level action on ticket list
- Pre-filled with original ticket data — passenger, carrier, PNR, route, dates, client, supplier all editable
- sell_price and purchase_price are READ-ONLY auto-computed displays — not editable inputs:
  - sell_price = original_sell_price + fare_difference + reissue_fee_collected
  - purchase_price = original_purchase_price + fare_difference + reissue_fee_paid
  - Both update live as the agent types the reissue fields
- Reissue Details section (editable): Reissue Fee Collected, Reissue Fee Paid, Fare Difference
- "Profit From Reissue" shown as a live read-only display: reissue_fee_collected - reissue_fee_paid
- Collapsible Record Payment section at bottom (same pattern as ticket form, uses computed sell_price)
- On save: original ticket marked reissued, new child ticket created with computed prices

## Edit Reissue Details Modal
- Opens from "Edit Reissue Details" row action on a reissue child ticket
- Pre-filled with the child's current reissue_fee_collected, reissue_fee_paid, fare_difference
- sell_price and purchase_price shown read-only, recomputed live the same way as the Reissue Modal — base price (backed out of the ticket's current stored prices) + fare_difference + fee
- On save: updates reissue_fee_collected, reissue_fee_paid, fare_difference, sell_price, purchase_price, office_markup
- This is the correct place to fix a reissue fee/fare entry mistake — editing sell_price/purchase_price directly via the generic ticket Edit action does not keep them in sync with the fee fields

## Refund Flow UI
- Initiated from row level action on ticket list
- Step 1 modal: enter refund_receivable, refund_payable, and an optional Notes field (saved to its own refund_notes column)
- Step 2: when supplier sends — Record Supplier Refund action updates refund_received
- Step 3: when paying client — Record Client Refund action updates refund_paid
- Refund margin shown at all times: refund_received - refund_payable
- Edit Refund Terms action (available whenever a refund exists, including after settlement): reopens the same modal pre-filled with the current refund_receivable / refund_payable / refund_notes. Updates only those fields — never refund_status, refund_received, or refund_paid.
- Edit Refund Received / Edit Refund Paid actions (available once that actual amount has been recorded): reopens the same modal pre-filled with the current refund_received / refund_paid, for correcting a typo in the real amount. Updates that field — never refund_status — and also syncs any linked payment record from Log Transaction (payments.amount for supplier_refund via ticket_id; the ticket_payments allocation, amount_paid, and payment_status for client_refund), so a correction from either side keeps both in sync. The client_refund sync is blocked with a validation error if it would drive amount_paid negative.

## Payment Allocation UX
- Triggered immediately after logging a client_payment or supplier_payment (from Payments page or client/supplier detail)
- Three options presented:
  1. Distribute evenly — splits payment equally across all pending tickets for that client/supplier
  2. Select tickets — agent picks specific tickets, system fills oldest first until money runs out, last ticket may be partial
  3. Skip — full amount sits as unallocated credit on client/supplier account
- Unallocated credit shown clearly on client/supplier profile
- Settle button on client page allows agent to allocate remaining credit at any time

## Log Transaction Modal (Payments Page)
- Accessed via "+ Log Transaction" button in the Payments page header
- Step 1: Type selector — four full-width cards:
  - Client Payment (Money In — green IN badge)
  - Supplier Payment (Money Out — red OUT badge)
  - Client Refund (Money Out — red OUT badge)
  - Supplier Refund (Money In — green IN badge)
- Step 2: Type-specific form. Common fields across all types: entity dropdown, Amount, Payment Channel, Transaction ID, Payment Date (default today), Notes. Back button returns to Step 1.
- Client Payment extras: collapsible "Forward to supplier" section — supplier dropdown, amount (auto-fills from payment amount), channel, trx_id, "Different amount to supplier" toggle
- Client/Supplier Refund extras: optional "Link to Ticket" searchable dropdown filtered by selected entity
- On save for client_payment/supplier_payment: AllocationModal triggered immediately
- On save for refunds: refreshes payments list

## Payment Details / Edit Modal (ViewPaymentModal)
- Opened via "View" (Payments page) or "View / Edit" (Client/Supplier Detail payment history) row action, for any payment type
- Read-only view by default; "Edit" button switches the amount/channel/trx_id/notes/payment_date fields into inputs, "Cancel" reverts, "Save changes" commits
- Amount editing rules by type:
  - client_payment / supplier_payment: unallocated_amount adjusts by the same delta as amount — can't reduce amount below the already-allocated portion
  - client_refund linked to a ticket: also updates that ticket's ticket_payments allocation and recomputes the ticket's amount_paid / payment_status; blocked with a validation error (not clamped) if the result would go negative
  - supplier_refund linked to a ticket (via payments.ticket_id): also updates that ticket's refund_received
  - client_refund not linked, or supplier_refund not linked: only the payment row updates — a note explains this doesn't cascade to any ticket
- "Allocated to Tickets" list always shown read-only below, same as the original view

## Forward to Supplier UX
- Optional section inside the client payment form (in Log Transaction Modal)
- Checkbox: Forward to supplier
- When checked reveals:
  - Supplier dropdown
  - Amount field auto-fills with client payment amount, editable
  - Channel dropdown
  - Transaction ID field
  - "Different amount to supplier" checkbox — reveals a custom Supplier Amount field
- On save: creates two independent payment rows

## Dashboard
- Period filter bar at top: This Month | Last Month | This Quarter | Last Quarter | This Year | All Time | Custom
  - Custom shows two date inputs (From / To)
  - Default: This Month
  - Tickets filtered by issue_date; payments filtered by payment_date
- Hide/Show Amounts toggle button in page header — masks all financial values with ••••• when hidden
- Row 1 — Period-sensitive cards (5, change with date filter):
  - Total Tickets (count)
  - Total Sales (sum of sell_price for period tickets)
  - Total Collected (sum of client_payment amounts in period)
  - Total Profit (sum of net_margin for period tickets)
  - Office Margin (sum of office_markup for period tickets)
- Row 2 — All-time cumulative cards (3, never filtered, each has "All time" tag at bottom-left):
  - Collection Pending (net outstanding receivable across all tickets)
  - Total Payable to Suppliers (net outstanding payable across all tickets)
  - Unallocated Client Credit (sum of unallocated client_payment amounts, all time)
- Row 3 — Needs Attention table: upcoming unpaid tickets, sorted by travel_date ascending, unaffected by period filter
  - Row highlighted red if ≤ 3 days until flight, yellow if ≤ 7 days
- Row 4 — Side by side: Recent Tickets + Recent Payments, both follow the period filter
  - Recent Tickets empty state: "No tickets in this period"
  - Recent Payments empty state: "No payments in this period"

## Client / Supplier Detail Pages
- Header actions: Edit | View Ledger | Log Payment
- "View Ledger" navigates to /reports/client-ledger?clientId=<uuid> (or supplier equivalent) and auto-generates the statement
- Three tabs: Tickets | Payment History | Documents
- Payment History tab row actions: View / Edit (opens ViewPaymentModal), Allocate (if unallocated_amount > 0), Delete (client side only — reverses any ticket_payments allocations first)
- Documents tab: shows uploaded document cards (type badge, filename, date); Open button generates a 1-hour signed URL; Delete removes from storage and DB; Upload button with type selector at the bottom; maximum 5 documents per entity

## Document Upload System
- Available in: Add/Edit Client modal, Add/Edit Supplier modal (staged upload before save), and Documents tab on detail pages (direct upload after save)
- Document types: Business Card, NID, Passport, Photo, Others
- Maximum 5 documents per entity (enforced in UI)
- In modals (DocUploadSection): files are staged in state with a type selector; uploaded to Supabase Storage after the entity is saved and the entity ID is known
- In detail pages (DocumentsTab): direct upload; type selector shown next to the upload button
- Files are stored in the `documents` Supabase Storage bucket (private); accessed via signed URLs

## Reports — Client Ledger (/reports/client-ledger)
- Client dropdown + date range (From / To) + Generate button
- Date range is optional — omit both for all-time view
- When navigated from a client detail page (via "View Ledger"), the client is pre-selected and statement auto-generates
- Opening Balance row: net amount the client owed before the period start (Dr = client owes us, Cr = we owe client)
- Ledger entry types (portal — descending by date):
  - Invoice (blue badge): one row per non-void ticket with issue_date in period; Debit = sell_price
  - Payment (green badge): one row per client_payment with payment_date in period; Credit = amount; description = "Unallocated Payment" or "Payment — [TrxID]"
  - Refund (red badge): one row per client_refund; Debit = amount
- Summary cards (period): Total Invoiced, Total Received, Total Refunded, Net Due, Unallocated Credit (all-time)
- "↓ Download PDF" button generates a PDF in ascending date order with running balance column

## Reports — Supplier Ledger (/reports/supplier-ledger)
- Same structure as Client Ledger but supplier-side
- Invoice Debit = purchase_price; supplier_payment and supplier_refund are both Credit entries (both reduce payable)
- Summary cards: Total Invoiced, Total Paid, Total Refunded, Net Payable, Unallocated

## Reports — Channel Ledger (/reports/channel-ledger)
- No entity selector — aggregates all payments for the agent across every channel (Cash, bKash, Bank, Office, EBL, DBBL, IBBL, City, BRAC, UCB, plus "No Channel" bucket if any payment has a null channel)
- Date range (From / To) only — optional, omit both for all-time view
- Inflow to a channel = client_payment + supplier_refund amounts logged against that channel; outflow = supplier_payment + client_refund amounts
- Grand totals strip: Total In, Total Out, Net Balance across all channels (period)
- Per-channel cards: one per channel, shows running balance (opening balance from before dateFrom + period in/out), clickable to filter the transaction list below to that channel
- Drill-down transaction table (descending by date): Date, Type badge, Party (client/supplier), Channel (hidden when a single channel is selected), Trx ID, signed Amount (+ green inflow, − red outflow)
- No PDF export on this report

## Ledger PDF Format
- Generated via jsPDF + jspdf-autotable; downloaded directly in browser
- Blue header bar: "TICKET TRACKER" + agent email left, "Statement of Account" + period + generated date right
- Entity name + ID block below header
- Summary section: Opening Balance, Total Invoiced, Total Received/Paid, Total Refunded, Net Due/Payable, Unallocated (2-column layout)
- Transaction table in ascending date order (oldest first) with columns: Date, Type, Description, Ref. Issue Date, Trx ID, Debit, Credit, Balance
- Balance column = running balance; positive = Dr (owed), negative = Cr; starts from opening balance
- Debit values shown in red, Credit in green, Balance red/green per sign
- Auto-pagination with page numbers in footer
- File named: ClientLedger_[Name]_[dateFrom].pdf or SupplierLedger_[Name]_[dateFrom].pdf

## Client Page
- Shows per-client summary: total billed, total received, unallocated credit, outstanding balance
- Lists all tickets with payment status per ticket
- Pending payment amount shown per ticket
- Settle button triggers allocation flow for unallocated credit
- Payment history tab shows all payment events with date, amount, channel, trx_id
- Documents tab shows uploaded files

## Ticket Detail View
- Shows full ticket information
- Shows chain margin if ticket is a reissue parent or child:
  - Original ticket margin
  - All child reissue margins
  - Chain net margin total
- Shows full payment history — all payment IDs that contributed, date, amount, channel
- Shows refund status and amounts if applicable
