import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"

const MODE_CONFIG = {
  initiate: { title: "Initiate refund", confirmLabel: "Start refund" },
  edit: { title: "Edit refund terms", confirmLabel: "Save changes" },
  supplier: { title: "Record supplier refund", confirmLabel: "Record received" },
  client: { title: "Record client refund", confirmLabel: "Record paid" },
  edit_supplier_actual: { title: "Edit Supplier Refund Received", confirmLabel: "Save changes" },
  edit_client_actual: { title: "Edit Client Refund Paid", confirmLabel: "Save changes" },
}

export default function RefundModal({ isOpen, onClose, ticket, mode, onSaved }) {
  const [receivable, setReceivable] = useState("")
  const [payable, setPayable] = useState("")
  const [notes, setNotes] = useState("")
  const [amount, setAmount] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (isOpen) {
      setReceivable(mode === "edit" && ticket?.refund_receivable != null ? String(ticket.refund_receivable) : "")
      setPayable(mode === "edit" && ticket?.refund_payable != null ? String(ticket.refund_payable) : "")
      setNotes(mode === "edit" ? ticket?.refund_notes ?? "" : "")
      setAmount(
        mode === "edit_supplier_actual" && ticket?.refund_received != null ? String(ticket.refund_received) :
        mode === "edit_client_actual" && ticket?.refund_paid != null ? String(ticket.refund_paid) :
        ""
      )
      setError("")
    }
  }, [isOpen, ticket, mode])

  if (!isOpen) return null

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")

    let updates

    if (mode === "initiate") {
      const refundReceivable = receivable !== "" ? parseFloat(receivable) : null
      const refundPayable = payable !== "" ? parseFloat(payable) : null
      updates = {
        refund_status: "initiated",
        refund_receivable: refundReceivable,
        refund_payable: refundPayable,
        refund_notes: notes.trim() || null,
      }
    } else if (mode === "edit") {
      updates = {
        refund_receivable: receivable !== "" ? parseFloat(receivable) : null,
        refund_payable: payable !== "" ? parseFloat(payable) : null,
        refund_notes: notes.trim() || null,
      }
    } else if (mode === "supplier") {
      const value = parseFloat(amount)
      if (isNaN(value)) {
        setError("Enter a valid amount")
        return
      }
      updates = {
        refund_received: value,
        refund_status: ticket.refund_paid != null ? "closed" : "supplier_refunded",
      }
    } else if (mode === "client") {
      const value = parseFloat(amount)
      if (isNaN(value)) {
        setError("Enter a valid amount")
        return
      }
      updates = {
        refund_paid: value,
        refund_status: ticket.refund_received != null ? "closed" : "client_refunded",
      }
    } else if (mode === "edit_supplier_actual") {
      const value = parseFloat(amount)
      if (isNaN(value)) {
        setError("Enter a valid amount")
        return
      }
      updates = { refund_received: value }
    } else if (mode === "edit_client_actual") {
      const value = parseFloat(amount)
      if (isNaN(value)) {
        setError("Enter a valid amount")
        return
      }
      updates = { refund_paid: value }
    }

    setLoading(true)

    // Keep any linked payment record (from Log Transaction) in sync with a corrected actual amount
    if (mode === "edit_supplier_actual") {
      const { error: prErr } = await supabase
        .from("payments")
        .update({ amount: updates.refund_received })
        .eq("ticket_id", ticket.id)
        .eq("type", "supplier_refund")
      if (prErr) { setLoading(false); setError(prErr.message); return }
    }

    if (mode === "edit_client_actual") {
      const { data: linkedTps, error: findErr } = await supabase
        .from("ticket_payments")
        .select("id, payment_id, allocated_amount")
        .eq("ticket_id", ticket.id)
        .eq("type", "client_refund")
      if (findErr) { setLoading(false); setError(findErr.message); return }

      const linkedTp = linkedTps?.[0]
      if (linkedTp) {
        const oldAmount = -(linkedTp.allocated_amount ?? 0)
        const newValue = updates.refund_paid
        const newAmountPaid = (ticket.amount_paid ?? 0) + oldAmount - newValue

        if (newAmountPaid < 0) {
          setLoading(false)
          setError(`That would leave the ticket's paid amount negative. The most this can be is ${((ticket.amount_paid ?? 0) + oldAmount).toLocaleString("en-BD")}.`)
          return
        }

        const newStatus = newAmountPaid <= 0 ? "unpaid" : newAmountPaid >= (ticket.sell_price ?? 0) ? "paid" : "partial"

        const { error: tpErr } = await supabase
          .from("ticket_payments")
          .update({ allocated_amount: -newValue })
          .eq("id", linkedTp.id)
        if (tpErr) { setLoading(false); setError(tpErr.message); return }

        const { error: pErr } = await supabase
          .from("payments")
          .update({ amount: newValue })
          .eq("id", linkedTp.payment_id)
        if (pErr) { setLoading(false); setError(pErr.message); return }

        updates.amount_paid = newAmountPaid
        updates.payment_status = newStatus
      }
    }

    const { data, error } = await supabase
      .from("tickets")
      .update(updates)
      .eq("id", ticket.id)
      .select(`*, clients(name), suppliers(name)`)
      .single()

    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    onSaved(data)
    onClose()
  }

  const config = MODE_CONFIG[mode] ?? MODE_CONFIG.initiate

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      onMouseDown={handleBackdrop}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{config.title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form id="refund-form" onSubmit={handleSubmit} className="space-y-3">
            {(mode === "initiate" || mode === "edit") && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expected from Supplier</label>
                  <input
                    type="number"
                    step="0.01"
                    value={receivable}
                    onChange={(e) => setReceivable(e.target.value)}
                    placeholder="0.00"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Agreed to pay Client</label>
                  <input
                    type="number"
                    step="0.01"
                    value={payable}
                    onChange={(e) => setPayable(e.target.value)}
                    placeholder="0.00"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional note"
                    className={inputCls}
                  />
                </div>
              </>
            )}

            {(mode === "supplier" || mode === "edit_supplier_actual") && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount received from supplier</label>
                <input
                  type="number"
                  required
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className={inputCls}
                />
                {ticket.refund_receivable != null && (
                  <p className="mt-1 text-xs text-gray-400">Expected: {Number(ticket.refund_receivable).toLocaleString("en-BD")}</p>
                )}
              </div>
            )}

            {(mode === "client" || mode === "edit_client_actual") && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount paid to client</label>
                <input
                  type="number"
                  required
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className={inputCls}
                />
                {ticket.refund_payable != null && (
                  <p className="mt-1 text-xs text-gray-400">Agreed: {Number(ticket.refund_payable).toLocaleString("en-BD")}</p>
                )}
              </div>
            )}
          </form>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="refund-form"
            disabled={loading}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Saving…" : config.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
