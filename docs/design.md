# Design Rules

## Stack
React + Vite
Tailwind CSS via @tailwindcss/vite plugin
No component library — build clean custom components

## Style Guidelines
- Clean, professional, minimal
- Primary color: blue (blue-600 for buttons, blue-50 for highlights)
- Use white cards with subtle shadows for content areas
- Mobile friendly but desktop first
- Sidebar navigation for main app
- Modals for add/edit forms

## Layout
- Authenticated pages: sidebar on left, content on right
- Sidebar links: Dashboard, Tickets, Clients, Suppliers, Payments, Settings
- Admin pages: separate layout with admin sidebar

## Components
- Reusable UI components go in src/components/ui/
- Feature components go in their respective folder (tickets, clients, suppliers, payments)
- Pages go in src/pages/agent/ for agent facing
- Pages go in src/pages/admin/ for admin facing

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
- Remove dynamic margin calculation display from the form entirely.
- Remove reported_price from the ticket form entirely.

## Ticket Form — Payment Sections
Two separate collapsible sections, both collapsed by default, both optional:

Section 1 — Client Payment:
  - Amount Received (numeric)
  - Payment Channel (dropdown: Cash, bKash, Bank, Office, EBL, DBBL, IBBL, City, BRAC, UCB)
  - Transaction ID (text)
  - Notes (text)
  - Paid in full checkbox — auto-fills amount = sell_price

Section 2 — Supplier Payment:
  - Amount Paid (numeric)
  - Payment Channel (same dropdown)
  - Transaction ID (text)
  - Notes (text)
  - Paid in full checkbox — auto-fills amount = purchase_price (not sell_price)

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
- Actions that aren't applicable are omitted from the menu entirely, never shown disabled

## Reissue Modal
- Opens from row level action on ticket list
- Pre-filled with original ticket data — all fields editable
- Additional fields: Reissue Fee Collected, Reissue Fee Paid, Fare Difference
- Reissue Margin shown as read-only auto-calculated
- Collapsible Record Payment section at bottom same as ticket form
- On save: original ticket marked reissued, new child ticket created

## Refund Flow UI
- Initiated from row level action on ticket list
- Step 1 modal: enter refund_receivable, refund_payable, and an optional Notes field (saved to its own refund_notes column)
- Step 2: when supplier sends — Record Supplier Refund action updates refund_received
- Step 3: when paying client — Record Client Refund action updates refund_paid
- Refund margin shown at all times: refund_received - refund_payable

## Payment Allocation UX
- Triggered immediately after logging a bulk payment from client page
- Three options presented:
  1. Distribute evenly — splits payment equally across all pending tickets for that client
  2. Select tickets — agent picks specific tickets, system fills oldest first until money runs out, last ticket may be partial
  3. Skip — full amount sits as unallocated credit on client account
- Unallocated credit shown clearly on client profile
- Settle button on client page allows agent to allocate remaining credit at any time

## Forward to Supplier UX
- Optional section inside the client payment form
- Checkbox: Forward to supplier
- When checked reveals:
  - Supplier dropdown filtered by agent suppliers
  - Amount field auto-fills with client payment amount, editable
  - Channel dropdown
  - Transaction ID field
  - Different amount to supplier checkbox
    - When checked reveals: Supplier Amount field + optional Reason field
- On save: creates two payment rows and handles allocation for both
- Supplier amount field never goes below 0

## Client Page
- Shows per-client summary: total billed, total received, unallocated credit, outstanding balance
- Lists all tickets with payment status per ticket
- Pending payment amount shown per ticket
- Settle button triggers allocation flow for unallocated credit
- Payment history tab shows all payment events with date, amount, channel, trx_id

## Ticket Detail View
- Shows full ticket information
- Shows chain margin if ticket is a reissue parent or child:
  - Original ticket margin
  - All child reissue margins
  - Chain net margin total
- Shows full payment history — all payment IDs that contributed, date, amount, channel
- Shows refund status and amounts if applicable
