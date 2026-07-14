import { deriveRefundStatus } from "./refunds"

export function derivePaymentStatus(amountPaid, sellPrice) {
  if (amountPaid <= 0) return "unpaid"
  if (amountPaid >= sellPrice) return "paid"
  return "partial"
}

// Reverses the effect of one ticket_payments row when its parent payment is
// deleted. allocated_amount is already signed (negative for client_refund /
// netted supplier_refund rows), so the same subtraction/addition works for
// both the normal and refund-settling cases. `clamped` flags when the
// reversal would have gone negative — the running total was already edited
// down below what this row contributed, so we're floor-clamping rather than
// truly undoing it.
export function reverseTicketPaymentRow(ticket, tp) {
  if (tp.type === "client") {
    const raw = (ticket.amount_paid ?? 0) - tp.allocated_amount
    const newAmountPaid = Math.max(0, raw)
    return {
      clamped: raw < 0,
      updates: { amount_paid: newAmountPaid, payment_status: derivePaymentStatus(newAmountPaid, ticket.sell_price ?? 0) },
    }
  }
  if (tp.type === "supplier") {
    // supplierAmountPaid is derived live from ticket_payments — nothing stored to reverse
    return { clamped: false, updates: {} }
  }
  if (tp.type === "client_refund") {
    const rawAmountPaid = (ticket.amount_paid ?? 0) - tp.allocated_amount
    const rawRefundPaid = (ticket.refund_paid ?? 0) + tp.allocated_amount
    const newAmountPaid = Math.max(0, rawAmountPaid)
    const newRefundPaid = Math.max(0, rawRefundPaid)
    return {
      clamped: rawAmountPaid < 0 || rawRefundPaid < 0,
      updates: {
        amount_paid: newAmountPaid,
        payment_status: derivePaymentStatus(newAmountPaid, ticket.sell_price ?? 0),
        refund_paid: newRefundPaid,
        refund_status: deriveRefundStatus({
          receivable: ticket.refund_receivable,
          received: ticket.refund_received,
          sellPrice: ticket.sell_price,
          amountPaid: newAmountPaid,
          payable: ticket.refund_payable,
        }),
      },
    }
  }
  if (tp.type === "supplier_refund") {
    const raw = (ticket.refund_received ?? 0) + tp.allocated_amount
    const newReceived = Math.max(0, raw)
    return {
      clamped: raw < 0,
      updates: {
        refund_received: newReceived,
        refund_status: deriveRefundStatus({
          receivable: ticket.refund_receivable,
          received: newReceived,
          sellPrice: ticket.sell_price,
          amountPaid: ticket.amount_paid,
          payable: ticket.refund_payable,
        }),
      },
    }
  }
  if (tp.type === "void_fee_client") {
    return { clamped: false, updates: { void_fee_collected: null } }
  }
  if (tp.type === "void_fee_supplier") {
    return { clamped: false, updates: { void_fee_paid: null } }
  }
  return { clamped: false, updates: {} }
}

// For a standalone supplier_refund payment (linked via payments.ticket_id,
// no ticket_payments row — see RefundModal/LogTransactionModal).
export function reverseStandaloneSupplierRefund(ticket, payment) {
  const raw = (ticket.refund_received ?? 0) - (payment.amount ?? 0)
  const newReceived = Math.max(0, raw)
  return {
    clamped: raw < 0,
    updates: {
      refund_received: newReceived,
      refund_status: deriveRefundStatus({
        receivable: ticket.refund_receivable,
        received: newReceived,
        sellPrice: ticket.sell_price,
        amountPaid: ticket.amount_paid,
        payable: ticket.refund_payable,
      }),
    },
  }
}

// Fields every reversal branch might need from the linked ticket(s).
export const TICKET_REVERSAL_FIELDS =
  "id, amount_paid, sell_price, refund_receivable, refund_payable, refund_received, refund_paid, void_fee_collected, void_fee_paid"
