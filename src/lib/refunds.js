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

// A void ticket that never went through the refund flow (refund_status still
// null) never had real money attached to the ORIGINAL sell_price/purchase_price
// — voiding replaces them with the void fee instead (see Void Flow docs): the
// client's new target becomes the fee charged to them, the supplier's new
// target becomes the fee owed to them, and the original sale is dropped from
// every calculation entirely. A void ticket that DID go through the refund
// flow (was paid, then voided with a refund negotiated) is handled the same
// as any other refunded ticket — the refund fields already capture what was
// actually retained, and its price fields were never touched by voiding.
function isUntouchedVoid(ticket) {
  return !!ticket.is_void && ticket.refund_status == null
}

// Void tickets created since the price-overwrite change (price_override_source
// === "void") already have sell_price/purchase_price set directly to the fee
// — these are plain passthroughs for them. Void tickets from before that
// change still carry their original, never-really-billed price with the fee
// living only in void_fee_collected/void_fee_paid — for those, substitute the
// fee here so stale historical data doesn't inflate outstanding/margin with
// numbers that were never real.
export function effectiveSellPrice(ticket) {
  if (isUntouchedVoid(ticket) && ticket.price_override_source !== "void") return ticket.void_fee_collected ?? 0
  return ticket.sell_price ?? 0
}
export function effectivePurchasePrice(ticket) {
  if (isUntouchedVoid(ticket) && ticket.price_override_source !== "void") return ticket.void_fee_paid ?? 0
  return ticket.purchase_price ?? 0
}

// Net client position: positive means the client still owes this much
// (Outstanding), negative means you owe the client this much back (Owed to
// Clients). refund_payable null is treated as 0 (no discount decided yet /
// non-refundable) — the formula then degrades to the ordinary
// sell_price - amount_paid for a ticket with no refund at all.
export function clientRefundNet(ticket) {
  return effectiveSellPrice(ticket) - (ticket.amount_paid ?? 0) - (ticket.refund_payable ?? 0)
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
  return effectiveSellPrice(ticket) - (ticket.refund_payable ?? 0)
}

// The remaining payable target on the supplier side, mirroring
// clientOutstanding. Callers are expected to exclude refund-active tickets
// themselves (refund_status != null) — once a refund starts, "how much do I
// still owe the supplier" is superseded by the refund reconciliation
// (refund_receivable/refund_received), tracked separately, not by this.
export function supplierOutstanding(ticket) {
  return Math.max(effectivePurchasePrice(ticket) - (ticket.supplierAmountPaid ?? 0), 0)
}

// Net margin for a single ticket — the figure "Total Margin" sums. Already
// accounts for refunds (booked/agreed basis, not actuals-so-far — see
// deriveRefundStatus comment above for why); void tickets are handled purely
// through effectiveSellPrice/effectivePurchasePrice above, no separate
// void-fee add-on needed since the fee IS the price for a void ticket.
export function ticketNetMargin(ticket) {
  const ticketMargin = effectiveSellPrice(ticket) - effectivePurchasePrice(ticket)
  // Booked/agreed basis, matching ticket_margin's own accrual nature — uses
  // refund_receivable (what the supplier agreed to) rather than refund_received
  // (what's actually landed so far), so this reflects the deal's true
  // economics instead of fluctuating with how far collection has progressed.
  const refundMargin = (ticket.refund_receivable ?? 0) - (ticket.refund_payable ?? 0)
  return ticketMargin + refundMargin
}

// Client-side revenue for a single ticket — what "Total Sales"/"Total
// Billed" should actually count. sell_price net of any agreed refund; for a
// void ticket, effectiveSellPrice already substitutes the fee for the
// original (never-really-billed) sale price.
export function ticketEffectiveSale(ticket) {
  return effectiveSellPrice(ticket) - (ticket.refund_payable ?? 0)
}

// Supplier-side cost for a single ticket — the mirror of ticketEffectiveSale
// for "Total Purchased". purchase_price net of what's been recovered from
// the supplier via a refund; void tickets go through effectivePurchasePrice
// the same way.
export function ticketEffectivePurchase(ticket) {
  return effectivePurchasePrice(ticket) - (ticket.refund_receivable ?? 0)
}
