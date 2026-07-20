import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { blockNonNumericKeys } from "../../lib/numberInput"
import { logActivity } from "../../lib/activityLog"
import { derivePaymentStatus } from "../../lib/paymentReversal"

function fmt(n) {
  return Number(n ?? 0).toLocaleString("en-BD")
}

export default function VoidConfirmModal({ isOpen, onClose, ticket, onSaved }) {
  const { agent } = useAuth()
  const [supplierFee, setSupplierFee] = useState("")
  const [clientFee, setClientFee] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (isOpen) {
      setSupplierFee("")
      setClientFee("")
      setError("")
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleConfirm = async () => {
    setError("")
    setLoading(true)

    const supplierFeeAmount = supplierFee !== "" ? parseFloat(supplierFee) : 0
    const clientFeeAmount = clientFee !== "" ? parseFloat(clientFee) : 0

    const { data, error } = await supabase
      .from("tickets")
      .update({
        is_void: true,
        status: "void",
        void_fee_paid: supplierFeeAmount > 0 ? supplierFeeAmount : null,
        void_fee_collected: clientFeeAmount > 0 ? clientFeeAmount : null,
        sell_price: clientFeeAmount,
        purchase_price: supplierFeeAmount,
        payment_status: derivePaymentStatus(ticket.amount_paid ?? 0, clientFeeAmount),
        price_override_source: "void",
      })
      .eq("id", ticket.id)
      .select(`*, clients(name), suppliers(name)`)
      .single()

    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }

    const feeNote = [
      clientFeeAmount > 0 ? `client fee ${fmt(clientFeeAmount)}` : null,
      supplierFeeAmount > 0 ? `supplier fee ${fmt(supplierFeeAmount)}` : null,
    ].filter(Boolean).join(", ")
    logActivity({
      agentId: agent.id,
      ticketId: ticket.id,
      eventType: "void",
      description:
        `Voided — sell_price ${fmt(ticket.sell_price)} → ${fmt(clientFeeAmount)}, ` +
        `purchase_price ${fmt(ticket.purchase_price)} → ${fmt(supplierFeeAmount)}` +
        (feeNote ? ` (${feeNote})` : " (no fees)"),
      metadata: {
        before: { sell_price: ticket.sell_price, purchase_price: ticket.purchase_price },
        after: { sell_price: clientFeeAmount, purchase_price: supplierFeeAmount },
        void_fee_collected: clientFeeAmount > 0 ? clientFeeAmount : null,
        void_fee_paid: supplierFeeAmount > 0 ? supplierFeeAmount : null,
      },
    })

    onSaved(data)
    onClose()
  }

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 px-4 py-6"
      onMouseDown={handleBackdrop}
    >
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-xl flex flex-col">
        <div className="px-6 py-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Void this ticket?</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            This replaces the ticket's sell price and purchase price with the fees below — the original
            sale is dropped from every calculation, since nothing real was transacted at those numbers.
            No payment is recorded here; collect or pay these fees later through the normal payment flow.
            This cannot be undone.
          </p>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
            Cancellation fees (optional)
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fee owed to supplier</label>
              <input type="number" onKeyDown={blockNonNumericKeys} min="0" step="0.01" value={supplierFee} onChange={(e) => setSupplierFee(e.target.value)} placeholder="0.00" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fee owed by client</label>
              <input type="number" onKeyDown={blockNonNumericKeys} min="0" step="0.01" value={clientFee} onChange={(e) => setClientFee(e.target.value)} placeholder="0.00" className={inputCls} />
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Voiding…" : "Mark as void"}
          </button>
        </div>
      </div>
    </div>
  )
}
