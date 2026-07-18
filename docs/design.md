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

## Number Inputs
Every `<input type="number">` across the app (prices, fees, amounts, reminder day/hour counts) is styled to look and behave like a plain text field, not the browser default:
- Native up/down spin buttons removed globally via CSS in `src/index.css` (`appearance: textfield` + the `::-webkit-inner/outer-spin-button` reset) — no per-input class needed, applies to any `type="number"` automatically.
- Alphabetic/symbol keystrokes blocked at the keydown level via `blockNonNumericKeys` (`src/lib/numberInput.js`), attached as `onKeyDown={blockNonNumericKeys}` on every number input — `type="number"` alone still lets you type letters like "e" and only rejects the value's validity afterward, which reads as broken. The blocker allows digits, one decimal point, a leading minus (fare_difference-style fields can go negative), and standard navigation/editing/copy-paste keys/shortcuts.
- New number inputs must both rely on the global CSS (automatic) and add `onKeyDown={blockNonNumericKeys}` explicitly (not automatic — has to be wired per input).

## Layout
- Authenticated pages: sidebar on left, content on right
- Sidebar links: Dashboard, Tickets, Clients, Suppliers, Payments, Reports (collapsible group), Settings
- Reports group expands/collapses on click; auto-expands when any /reports/* route is active
- Reports sub-links: Client Ledger, Supplier Ledger, Channel Ledger
- Sidebar is collapsible to a narrow icon-only rail (w-16, vs w-60 expanded) — toggle button (chevron) sits next to the logo. Preference persists in localStorage (`sidebar_collapsed`), read on mount so it doesn't flash open before applying. Collapsed state shows icons only with native `title` tooltips; clicking Reports while collapsed expands the sidebar first (opens the group) rather than trying to fit a submenu flyout in a 64px rail. AppLayout's content margin (`ml-16`/`ml-60`) tracks the same state, owned by AppLayout and passed down to Sidebar as props
- Admin pages: separate layout with admin sidebar (not collapsible — smaller, rarely-used panel, out of scope for this)

## Dark Mode
- Theme model: `theme` is the stored preference (`light` | `dark` | `system`), `resolvedTheme` is the actually-applied value (`light` | `dark`) after resolving `system` against `window.matchMedia("(prefers-color-scheme: dark)")`. Implemented in `src/context/ThemeContext.jsx` (`ThemeProvider`/`useTheme`, same createContext/Provider/hook shape as `AuthContext`), wrapping the app in `main.jsx` outside `AuthProvider`.
- Persisted to `localStorage` under key `theme`. A live `matchMedia` `change` listener keeps `resolvedTheme` in sync if the OS theme changes while `system` is selected.
- Tailwind v4 dark variant is class-based, not just OS-preference-based: `src/index.css` declares `@custom-variant dark (&:where(.dark, .dark *));` right after `@import "tailwindcss";`. `ThemeContext` toggles the `.dark` class on `document.documentElement`.
- FOUC prevention: `index.html` has an inline `<script>` in `<head>`, run before React mounts, that reads `localStorage.getItem("theme")` and synchronously applies/removes `.dark` on `<html>` — mirrors `ThemeContext`'s logic so the two never disagree.
- Toggle placements (per "standard SaaS" request — both sidebar and Settings):
  - `ThemeToggleCompact` (`src/components/ui/ThemeToggle.jsx`): icon-only button in the agent sidebar footer (and admin sidebar footer) that cycles Light → Dark → System on click; icon reflects the selected mode (sun/moon/monitor), not the resolved theme.
  - `ThemeToggleFull`: three-way segmented control (Light / Dark / System) in an "Appearance" section on the Settings page.
- Color-mapping convention used for the retrofit (light → dark):
  - Page canvas (`min-h-screen bg-gray-50`) → `dark:bg-gray-950` (darkest layer)
  - Card/surface (`bg-white`) → `dark:bg-gray-900`
  - Nested sections / table headers / hover backgrounds (`bg-gray-50`, `bg-gray-100`) → `dark:bg-gray-800`
  - Borders/dividers shift roughly 4-5 steps lighter (e.g. `border-gray-200` → `dark:border-gray-800`), body/label text shifts similarly (`text-gray-700` → `dark:text-gray-300`, `text-gray-900` → `dark:text-gray-100`)
  - Colored status badges/banners (`bg-{color}-50/100` + `text-{color}-600/700`) → opacity-based dark backgrounds (`dark:bg-{color}-900/20` or `/30`) + `dark:text-{color}-400`, never solid dark-mode color fills
  - Where a `bg-gray-50` element also has `hover:bg-gray-100` (e.g. collapsible section headers), the hover dark shade is bumped to `dark:hover:bg-gray-700` (one step lighter than the base `dark:bg-gray-800`) so hover still reads as a visible state change
- Known gaps fixed after the initial retrofit (watch for recurrences of both patterns elsewhere):
  - All text/number/date `<input>`, `<select>`, and `<textarea>` elements need an explicit `text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500` — without it, form controls have no set text/placeholder color, so they inherit the default (near-black) color and become illegible against a dark background. Every `inputCls` constant and inline form-field className across the app now carries this; any new form field must too.
  - The Tickets/Clients/Suppliers list-table row hover used `hover:bg-slate-50` (Tailwind's `slate` scale, not `gray`) with no `dark:` counterpart at all — it was missed by the dark-mode retrofit because that pass only targeted the `gray` scale. Fixed to `hover:bg-slate-50 dark:hover:bg-gray-800`. If a future row/list adds a bare `slate-*` utility, it needs its own explicit `dark:` variant — it won't be caught by the `gray`-scale convention above.
  - Native browser-rendered form controls (the date/time picker icon and popup, `<select>`'s dropdown arrow, scrollbars, checkbox/radio) ignore our `dark:` classes entirely — they're drawn by the browser, not the page, and default to a light-theme rendering (e.g. a solid black calendar icon) regardless of the input's own background. Fixed globally in `src/index.css` via the CSS `color-scheme` property, toggled off the same `.dark` class ThemeContext already manages: `:root { color-scheme: light; }` / `:root.dark { color-scheme: dark; }`. No per-input changes needed — this covers every native control app-wide.
  - `color-scheme` fixed the date picker and scrollbars but was not enough on its own for the open `<select>` option-list panel — browser support for `color-scheme` on that specific popup is inconsistent, and it was observed rendering as a white panel with our `dark:text-gray-100` (inherited onto `<option>`) still applied, i.e. white text on white. `background-color`/`color` are among the few properties browsers do honor directly on `<option>`, so `src/index.css` also sets them explicitly: `:root.dark select option { background-color: var(--color-gray-900); color: var(--color-gray-100); }`.

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

## Ticket Clone
- "Clone" row action (Tickets page, both Compact and Detailed views, next to Edit) opens `TicketModal` pre-seeded from the source ticket, but as a create — not update.
- Copied fields: passenger_name, carrier, ticket_number, pnr, route, issue_date, travel_date, return_date, client_id, supplier_id, purchase_price, gds_price, sell_price, narration — i.e. every core ticket-identity/flight/pricing field.
- Deliberately NOT copied: id (so the modal inserts a new row instead of updating the source), status (defaults back to "booked", same as any new ticket), and everything payment/refund-related (amount_paid, payment_status, refund_status and all refund_* fields, is_void, is_reissue) — the clone starts life exactly like a brand-new ticket, regardless of how settled/refunded/reissued the source ticket is.
- `TicketModal` takes a `cloneMode` prop purely for copy ("Clone ticket" title, "Save cloned ticket" button) — the actual create-vs-update decision and the inline-payment-section visibility both key off `ticket?.id` (not bare `ticket` truthiness), so a clone-seed object (no id) is treated exactly like the normal "add ticket" flow: initial client/supplier payment can still be entered fresh, it just isn't pre-filled from the source.

## Plan Gating (future)
- Supplier Purchase Price field hidden for non-pro users
- Office markup dashboard section hidden for non-pro users

## Ticket List
- Single flat list — no separate tabs for reissues, voids, refunds
- Sorted by issue_date descending (latest first); tickets without issue_date fall to the bottom
- Issue Date is the first column, followed by Travel Date, then Passenger, Route, etc.
- Computed sentence-case chip badges per ticket (small pills, not bracketed tags), multiple can show at once:
  - Payment: Unpaid (red), Partial (yellow), Paid (green)
  - Flight: Upcoming (blue), Flying tomorrow (indigo), Flying today (purple), Return pending (orange), Flown (gray) — mutually exclusive, one flight chip per ticket based on travel_date vs today/tomorrow (both computed as local-midnight-derived date strings, same convention throughout)
  - Lifecycle: Void (gray), Reissued (orange, on parent), Reissue (blue, on child), Refund (yellow, refund_status is set and not closed — initiated/supplier_refunded/client_refunded all show the same chip, since they're all "still in progress"), Refunded (red, refund_status = closed)
- Outstanding amount shown per ticket row
- Compact/Detailed view toggle (defaults to Compact): Compact columns are Issue Date, Flight Date, PNR, Ticket No., Route, Passenger, Client, Sell, Outstanding, Status, Actions — a trimmed subset of Detailed's full column set (which additionally has Carrier, Supplier, Purchase, Margin, Net, Paid, Narration)

## Row Level Actions on Ticket List
- Actions are grouped behind a hamburger-menu button per row (not inline buttons) — opens a dropdown, closes on outside click
- Edit, Delete, and View are always present in the menu
- Contextual actions are shown/hidden per-action based on ticket state, not a fixed per-status table:
  - Void: status not void, not reissued, refund_status not closed
  - Refund: status not void, not reissued, refund_status is null
  - Reissue: status not void, not reissued, refund_status not initiated
  - Record Payment: payment_status not paid and status not void
  - Record Supplier Refund / Record Client Refund: shown independently per side whenever refund_status is set and not closed — available repeatedly, not gated on the other side or on existing progress on this side (label switches to "Add Supplier Refund Receipt" / "Add Client Refund Payment" once that side already has some progress)
  - Edit Refund Terms: shown whenever a refund exists (refund_status not null), including after settlement
  - Edit Refund Received / Edit Refund Paid: shown per side once that side's actual amount has been recorded, for correcting typos
  - Cancel Refund: shown whenever a refund exists (refund_status not null), including after settlement — see "Cancelling a Refund" below
  - Edit Reissue Details: shown on reissue child tickets (is_reissue = true), not void
- Actions that aren't applicable are omitted from the menu entirely, never shown disabled
- Suppliers list also uses the same hamburger-menu pattern for row actions

## Void Confirm Modal
- Opens from the "Void" row action — still a confirm-to-proceed modal ("This cannot be undone"), not a full form
- Adds an optional "Cancellation fees" section: two independent amount + channel pairs — "Fee charged by supplier" and "Fee charged to client" — both blank by default, no requirement to fill either
- Blocked with an inline error if an amount is entered on a side the ticket has no client_id/supplier_id for
- On confirm: any non-zero fee creates a real, channel-tracked payment (client_payment / supplier_payment) allocated to the ticket, in addition to voiding it — so cancellation fees show up in Payments, Channel Ledger, and the entity's payment history like any other transaction

## Reissue Modal
- Opens from row level action on ticket list
- Deliberately minimal — only fields that plausibly change on a reissue are shown:
  - Passenger: Passenger Name (editable), Ticket Number, PNR
  - Travel: Route, Issue Date, Travel Date, Return Date
  - Financials (see below)
  - Reissue Details, Notes
- Carrier, Client, and Supplier are NOT shown for re-selection — they're carried over silently from the original ticket as-is (a reissue is virtually always the same airline/client/supplier as the ticket it's reissuing). Use the normal ticket Edit action on the new child ticket afterward for the rare case where one of these needs to actually change.
- No Record Payment section — a reissue only creates the ticket row. Recording a payment against it afterward uses the same Record Payment row action as any other ticket.
- Field order in the form: Reissue Details (the optional breakdown) comes BEFORE Financials, so the relationship reads top-to-bottom — fill in the breakdown, watch it flow down into the prices.
- Two ways to set sell_price/purchase_price, both supported at once — INCREMENTAL either way (this reissue's own price, not the original ticket's price rolled forward, same reasoning as before):
  1. **Direct entry** — Sell Price / Purchase Price are real, always-editable inputs. An agent who already knows the final numbers can just type them and skip the breakdown fields entirely (they're optional).
  2. **Breakdown entry** — four fields, grouped in the form by which side they feed (not listed in one flat row):
     - **Feeds both** (pass-throughs — added identically to both sides, zero margin impact on their own): Airlines Penalty (the change fee the airline charges, owed to the client and to the supplier equally), Fare Difference (price difference between old and new fare, can be negative).
     - **Feeds Sell Price only**: Reissue Margin — the agent's own markup on top of the pass-through costs.
     - **Feeds Purchase Price only, as a deduction**: Commission — auto-calculated as 7% of Fare Difference (rounded to 2dp), representing the commission earned back on the fare-difference booking, which reduces the effective cost. Same detach/mismatch-hint pattern as Sell Price/Purchase Price below (see `commissionDirty` in ReissueModal): auto-fills live until the agent edits it directly, at which point it detaches, with an inline hint if it then disagrees with the 7% auto-calc.
     - `sell_price = airlines_penalty + reissue_margin + fare_difference`
     - `purchase_price = airlines_penalty + fare_difference − commission`
     - Only Reissue Margin and Commission actually move the margin — Airlines Penalty and Fare Difference cancel out between the two prices on their own.
  - **Interaction between the two**: each price field starts by mirroring the live breakdown total. The instant the agent types into a price field directly — whether it was blank, already showing 0, or already auto-filled from the breakdown — it detaches and stays exactly what they typed, permanently, even if the breakdown fields are edited afterward. This holds regardless of order (direct-entry-first, or breakdown-first-then-manually-adjusted both detach the same way). Sell Price and Purchase Price detach independently of each other.
  - Once detached, if the entered value differs from what the breakdown currently implies, an inline amber hint appears under that price field: "Breakdown implies X — differs by Y", with a "Use X instead" link that re-attaches the field to live-sync from the breakdown again (and keeps following it from then on, until touched directly again). Not shown when the two happen to match, or when the field was never touched.
  - A separate "new ticket total" line shows original_sell_price + (whichever sell_price actually ends up saved, direct or breakdown-derived) — informational only, never stored.
- gds_price (Supplier Purchase Price) starts blank — not pre-filled from the original ticket, since it's this reissue's own informational supplier cost
- "Profit From Reissue" = the real sell_price - purchase_price that will actually be saved (not just the breakdown's fee spread) — so it stays accurate even when one or both prices were entered directly instead of computed
- On save: original ticket marked reissued (nothing else about it changes — its own sell_price/purchase_price/issue_date stay exactly as originally booked, permanently), new child ticket created as its own independent ticket row with only the incremental price

## Edit Reissue Details Modal
- Opens from "Edit Reissue Details" row action on a reissue child ticket
- Pre-filled with the child's current airlines_penalty, fare_difference, reissue_margin, commission — same four-field breakdown as the Reissue Modal, same "feeds both" / "feeds Sell Price" / "feeds Purchase Price" grouping
- sell_price and purchase_price shown read-only, recomputed live from the breakdown the same way as the Reissue Modal's breakdown path (this modal doesn't have the Reissue Modal's separate direct-entry mode — it only edits the breakdown fields)
- Commission has the same auto-calc-at-7%-of-fare_difference-until-edited-directly pattern as the Reissue Modal, including the mismatch hint. Re-opening this modal on a ticket that already has a stored commission value starts it "dirty" (not auto-recalculating), so simply opening the modal never silently replaces a previously-chosen commission override
- On save: updates airlines_penalty, fare_difference, reissue_margin, commission, sell_price, purchase_price, office_markup
- This is the correct place to fix a reissue breakdown entry mistake — editing sell_price/purchase_price directly via the generic ticket Edit action does not keep them in sync with the breakdown fields

## Refund Flow UI
- Initiated from row level action on ticket list
- Step 1 modal: enter refund_receivable, refund_payable, and an optional Notes field (saved to its own refund_notes column). refund_receivable is the agreed target from the supplier. refund_payable is how much you're liable to hand the client back — 0/blank = non-refundable (client still owes the full remaining sell_price), equal to sell_price = full forgiveness, anything between is a partial discount/fee
- A live preview line updates as you type refund_payable: "→ Client will owe X", "→ You will owe client Y back", or "→ Settled" — computed from the ticket's sell_price/amount_paid against the value being typed, so the result can be checked against intent before saving
- Step 2: Record Supplier Refund action — creates a real, channel-tracked payment and adds the amount to the ticket's cumulative refund_received. Repeatable — a refund can be settled across multiple partial receipts
- Step 3, client side settles in one of two directions depending on whether the client had already paid more than the new net target (see database.md's "Client Net Position"):
  - Owed cash back: Record Client Refund action — creates a real, channel-tracked payment, adds the amount to the ticket's cumulative refund_paid, and subtracts it from amount_paid (floored at 0). The modal shows the current remaining owed-back amount live, not just the agreed/paid-so-far totals. Repeatable
  - Still owes (most commonly a credit booking, or a partial payment below the new net target): settled via the ordinary Record Payment action, not a refund action at all — RecordPaymentModal targets the reduced amount (sell_price − refund_payable) once a refund is active, and its "Outstanding amount" line notes "(reduced by an active refund)"
- refund_status is derived after every recording action — client side by comparing sell_price/amount_paid/refund_payable as a net position, not refund_paid against refund_payable directly (see database.md's "Client Net Position") — never manually set past initiation
- Refund margin shown at all times: refund_receivable - refund_payable (booked/agreed basis — see database.md's Margin Calculations)
- Edit Refund Terms action (available whenever a refund exists, including after settlement): reopens the same modal pre-filled with the current refund_receivable / refund_payable / refund_notes (same live preview as Step 1). Updates those fields and recomputes refund_status against the new targets — never touches refund_received or refund_paid
- Edit Refund Received / Edit Refund Paid actions (available once that side's cumulative total is > 0): reopens the same modal pre-filled with the current running total, for overriding the total directly (e.g. to correct a typo across one or more receipts). This is a blunt override — it does NOT reverse-sync the individual payment/ticket_payments rows that fed into that total, and (client side) does NOT adjust amount_paid — refund_paid is purely an audit counter now, not what determines settlement. To correct one specific receipt, edit that payment via ViewPaymentModal instead

## Cancelling a Refund
- There was previously no way back to "no refund at all" once initiated — refund_status only ever moves between initiated/supplier_refunded/client_refunded/closed, never back to null on its own, even if the terms are edited down to 0
- "Cancel Refund" row action (shown whenever a refund exists, any state): first checks whether any real payment has actually been recorded against the ticket (a standalone supplier_refund payment, or a client_refund/supplier_refund ticket_payments row from a direct recording or netted allocation)
  - If any exist: blocked with an inline error directing you to delete those payments first (from the ticket's payment history or the Payments page) — deleting them already correctly reverses their effect via the shared payment-reversal logic, at which point Cancel Refund becomes available
  - If none exist: confirms, then wipes refund_status/refund_receivable/refund_received/refund_payable/refund_paid/refund_notes all back to null — the ticket becomes indistinguishable from one that never had a refund
- A blunt "Edit Refund Received/Paid" override with no real payment behind it doesn't block cancellation — those numbers just clear along with everything else, same as if they'd never been entered

## Refund-Aware Allocation (Netting)
- AllocationModal (client bulk payments) and SupplierAllocationModal (supplier bulk payments) both offer a second allocation target alongside normal outstanding fare/purchase price: any ticket with an open refund and a positive remaining balance on that side
- Covers the "netting" case — an incoming bulk client payment covering one ticket's fare while implicitly settling a refund owed on a different ticket for the same client (or the supplier-side mirror: an outgoing bulk supplier payment that nets off a refund the supplier owes)
- "Select Tickets" mode shows a Purpose badge per row — "Fare" (blue) or "Refund owed" (orange) — so it's clear which kind each allocation settles
- "Distribute Evenly" mode only ever splits across fare-kind tickets; refund-kind tickets are select-only
- Refund-kind allocations create a ticket_payments row (negative allocated_amount, type=client_refund or supplier_refund) and update the ticket's refund_received/refund_paid + refund_status exactly like a standalone refund receipt would, just funded from this bulk payment instead of a separate one

## Payment Allocation UX
- Triggered immediately after logging a client_payment or supplier_payment (from Payments page or client/supplier detail)
- Also triggered from the ticket list's "Record Payment" action, but only if the amount typed exceeds that ticket's outstanding — the excess is left unallocated and this modal opens automatically to distribute it across the client's other tickets; entering an amount at or below outstanding never opens it (nothing left over)
- Three options presented:
  1. Distribute evenly — splits payment equally across all pending fare tickets for that client/supplier
  2. Select tickets — agent picks specific tickets (fare or refund purpose, see "Refund-Aware Allocation"), system fills oldest first until money runs out, last ticket may be partial
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
- On save for refunds: refreshes payments list. If linked to a ticket that has an open refund on file, also advances that ticket's cumulative refund_received/refund_paid and recomputes refund_status the same way RefundModal's row actions do — a plain fare-refund link (no open refund on file) only adjusts amount_paid, same as before

## Deleting a Payment (Payments Page, Client Detail, Supplier Detail)
- Three entry points share the same reversal logic (`src/lib/paymentReversal.js` — `reverseTicketPaymentRow`, `reverseStandaloneSupplierRefund`), so they can't drift apart the way the old duplicated Client Detail version once did:
  - Payments page: every row (any type) has a "Delete" action alongside View/Allocate
  - Client Detail's Payment History tab: "Delete" in the row's action menu (client_payment rows only — this tab only ever lists client_payment payments, client_refund isn't shown there)
  - Supplier Detail's Payment History tab: same, "Delete" in the row's action menu (supplier_payment rows only)
- Reverses every linked ticket_payments row before deleting it, branching by that row's type — not payments.type, since one payment can allocate across ticket_payments rows of different types:
  - client / supplier: client reverses amount_paid + payment_status; supplier reverses nothing (supplierAmountPaid is derived live from ticket_payments, so it self-corrects once the row is gone)
  - client_refund: reverses amount_paid (adds back), refund_paid (subtracts), recomputes payment_status and refund_status
  - supplier_refund (netted via SupplierAllocationModal): reverses refund_received, recomputes refund_status
  - void_fee_client / void_fee_supplier: nulls out void_fee_collected / void_fee_paid (single-value fields, never counted in amount_paid to begin with)
- A standalone supplier_refund payment (linked via payments.ticket_id, no ticket_payments row — see RefundModal/LogTransactionModal) reverses refund_received directly against that ticket. Only reachable from the Payments page today, since neither detail page ever lists supplier_refund/client_refund payments (both are filtered to plain client_payment/supplier_payment only)
- All reversals floor at 0 rather than go negative. If a running total was already edited down below what this payment contributed (e.g. via "Edit Refund Paid"), the confirm dialog warns that the reversal will floor-clamp rather than fully undo the payment
- Forward-to-Supplier pairs are NOT linked in the schema — deleting one side never touches the other
- Not atomic (sequential calls, no DB transaction) — consistent with the rest of the app

## Payment Details / Edit Modal (ViewPaymentModal)
- Opened via "View" (Payments page) or "View / Edit" (Client/Supplier Detail payment history) row action, for any payment type
- Read-only view by default; "Edit" button switches the amount/channel/trx_id/notes/payment_date fields into inputs, "Cancel" reverts, "Save changes" commits
- Amount editing rules by type:
  - client_payment / supplier_payment: unallocated_amount adjusts by the same delta as amount — can't reduce amount below the already-allocated portion
  - client_refund linked to a ticket: the amount delta shifts that ticket's ticket_payments allocation, amount_paid (opposite direction), and refund_paid (same direction), recomputing payment_status/refund_status; blocked with a validation error (not clamped) if amount_paid or refund_paid would go negative
  - supplier_refund linked to a ticket (via payments.ticket_id): the amount delta shifts that ticket's refund_received, recomputing refund_status; blocked with a validation error if refund_received would go negative
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
- Payment History tab row actions: View / Edit (opens ViewPaymentModal), Allocate (if unallocated_amount > 0), Delete — same on both Client and Supplier Detail (see "Deleting a Payment" below for the full reversal rules)
- The row action menu (kebab) is portal-rendered and positions itself from the button's own bounding rect, flipping above when there isn't room below — matches the Tickets list's row action menu. Fixes the menu clipping/disappearing for the last row of the table (or a single-row table), which the earlier `absolute` + `top-full` positioning was prone to
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
- No entity selector — aggregates all payments for the agent across every channel (dynamic, per-agent list from payment_channels — see "Payment Channels" below — plus a "No Channel" bucket for any payment that doesn't resolve to one)
- Date range (From / To) only — optional, omit both for all-time view
- Inflow to a channel = client_payment + supplier_refund amounts logged against that channel; outflow = supplier_payment + client_refund amounts
- Grand totals strip: Total In, Total Out, Net Balance across all channels (period), Net Balance includes every channel's starting_balance
- Per-channel cards: one per active channel plus "No Channel", shows running balance (starting_balance + opening balance from before dateFrom + period in/out), clickable to filter the transaction list below to that channel
- Archived channels collapsed behind a "Show archived (n)" toggle below the active cards — still fully reportable, just out of the way by default
- Each channel card has a kebab menu: Edit (reopens ChannelModal), Archive/Restore
- "+ Add Channel" button in the page header opens ChannelModal in create mode
- Drill-down transaction table (descending by date): Date, Type badge, Party (client/supplier), Channel (hidden when a single channel is selected), Trx ID, signed Amount (+ green inflow, − red outflow)
- No PDF export on this report

## Payment Channels (per-agent wallets)
- Table: payment_channels (agent_id, name, starting_balance, is_active) — replaces the old hardcoded 10-value CHANNELS list; every payment-logging form (Log Payment, Log Transaction, Record Payment, Reissue, Ticket Form, and the Payments filter) now fetches the agent's active channels instead of a fixed array
- ChannelModal (src/components/payments/ChannelModal.jsx) — create/edit, two fields: Channel Name (required) and Starting Balance (optional, defaults to 0)
- Duplicate name handling: case-insensitive, trimmed comparison against all of the agent's channels (active + archived). A collision doesn't block the save — it shows a confirmation step ("already exists, save as 'Bkash 2'?") with the next available numeric suffix, backed by a case-insensitive unique DB index as the real guard against races
- A channel with existing payments can never be hard-deleted — Archive (is_active = false) is the only removal path. Archived channels disappear from "pick a channel" dropdowns on new payments but stay fully visible in history, filters, and Channel Ledger, and can be restored
- payments.channel (legacy text) is kept in sync on every write for safety, but payments.channel_id is the source of truth going forward

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
- Shows full payment history — all payment IDs that contributed, date, amount, channel. Merges two sources: ticket_payments rows (client/supplier/client_refund/supplier_refund/void_fee_*) and, separately, any supplier_refund payments linked via payments.ticket_id directly (these don't have a ticket_payments row), sorted together by date
- Shows refund status and amounts if applicable
