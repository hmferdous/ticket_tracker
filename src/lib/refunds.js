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
