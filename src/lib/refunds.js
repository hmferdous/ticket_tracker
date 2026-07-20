// Compares cumulative actuals against agreed targets rather than exact-match/
// null checks, so a refund with partial progress on either side — or settled
// across multiple installments — still derives the right status.
//
// Supplier side is a pure cash-recovery check: you already paid the
// supplier, and refund_receivable/refund_received track getting some of it
// back. No agreed target (null) means nothing left to collect.
//
// Client side is a net position, not a cash counter. refund_payable means
// "how much I'm liable to hand the client back" — 0 (or unset) is a
// non-refundable ticket (full sell_price still due), sell_price is full
// forgiveness, anything between is a partial discount/fee. Comparing it
// against refund_paid alone breaks the common case where the client hadn't
// paid yet (a credit booking): refund_paid never moves there, since there's
// no cash to hand back — the client just pays the reduced net amount via a
// normal payment instead. So the client side is "done" when the net
// position (sell_price - amount_paid - refund_payable) is exactly zero —
// nothing left owed in either direction — not when refund_paid alone
// catches up to refund_payable.
export function deriveRefundStatus({ receivable, received, sellPrice, amountPaid, payable }) {
  const supplierDone = receivable == null || (received ?? 0) >= receivable
  const clientDone = clientRefundNet({ sell_price: sellPrice, amount_paid: amountPaid, refund_payable: payable }) === 0
  if (supplierDone && clientDone) return "closed"
  if (supplierDone) return "supplier_refunded"
  if (clientDone) return "client_refunded"
  return "initiated"
}

// Net client position: positive means the client still owes this much
// (Outstanding), negative means you owe the client this much back (Owed to
// Clients). refund_payable null is treated as 0 (no discount decided yet /
// non-refundable) — the formula then degrades to the ordinary
// sell_price - amount_paid for a ticket with no refund at all.
export function clientRefundNet(ticket) {
  return (ticket.sell_price ?? 0) - (ticket.amount_paid ?? 0) - (ticket.refund_payable ?? 0)
}

export function clientOutstanding(ticket) {
  return Math.max(clientRefundNet(ticket), 0)
}

export function clientOwedBack(ticket) {
  return Math.max(-clientRefundNet(ticket), 0)
}

// The real remaining collection target for the client side, once a refund's
// reduced the original sell_price down. Degrades to sell_price for a ticket
// with no refund (refund_payable null).
export function clientEffectiveTarget(ticket) {
  return (ticket.sell_price ?? 0) - (ticket.refund_payable ?? 0)
}

// A void ticket that never went through the refund flow (refund_status still
// null) never had real money attached to sell_price/purchase_price in the
// first place — per the Void Flow docs, it "sits as void record with zero
// margin impact" unless a standalone cancellation fee was charged. A void
// ticket that DID go through the refund flow (was paid, then voided with a
// refund negotiated) is handled the same as any other refunded ticket —
// the refund fields already capture what was actually retained.
function isUntouchedVoid(ticket) {
  return !!ticket.is_void && ticket.refund_status == null
}

// Net margin for a single ticket — the figure "Total Margin" sums. Already
// accounts for refunds (booked/agreed basis, not actuals-so-far — see
// deriveRefundStatus comment above for why) and standalone void fees; also
// zeroes out the sell/purchase-price margin for a void ticket nothing was
// ever really transacted on, leaving only its void fee margin (if any).
export function ticketNetMargin(ticket) {
  const voidFeeMargin = (ticket.void_fee_collected ?? 0) - (ticket.void_fee_paid ?? 0)
  if (isUntouchedVoid(ticket)) return voidFeeMargin

  const ticketMargin = (ticket.sell_price ?? 0) - (ticket.purchase_price ?? 0)
  // Booked/agreed basis, matching ticket_margin's own accrual nature — uses
  // refund_receivable (what the supplier agreed to) rather than refund_received
  // (what's actually landed so far), so this reflects the deal's true
  // economics instead of fluctuating with how far collection has progressed.
  const refundMargin = (ticket.refund_receivable ?? 0) - (ticket.refund_payable ?? 0)
  return ticketMargin + refundMargin + voidFeeMargin
}

// Client-side revenue for a single ticket — what "Total Sales"/"Total
// Billed" should actually count. An untouched void contributes only its
// standalone cancellation fee (if any), not the never-really-billed
// sell_price. Otherwise: sell_price net of any agreed refund, plus any void
// fee charged (a real, separate cancellation-handling charge, additive
// regardless of refund state).
export function ticketEffectiveSale(ticket) {
  const voidFeeRevenue = ticket.void_fee_collected ?? 0
  if (isUntouchedVoid(ticket)) return voidFeeRevenue
  return (ticket.sell_price ?? 0) - (ticket.refund_payable ?? 0) + voidFeeRevenue
}

// Supplier-side cost for a single ticket — the mirror of ticketEffectiveSale
// for "Total Purchased". purchase_price net of what's been recovered from
// the supplier via a refund, plus any void fee actually paid to the
// supplier.
export function ticketEffectivePurchase(ticket) {
  const voidFeePaid = ticket.void_fee_paid ?? 0
  if (isUntouchedVoid(ticket)) return voidFeePaid
  return (ticket.purchase_price ?? 0) - (ticket.refund_receivable ?? 0) + voidFeePaid
}
