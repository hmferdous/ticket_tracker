import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"

function buildForm(ticket) {
  return {
    reissue_fee_collected: ticket?.reissue_fee_collected != null ? String(ticket.reissue_fee_collected) : "",
    reissue_fee_paid: ticket?.reissue_fee_paid != null ? String(ticket.reissue_fee_paid) : "",
    fare_difference: ticket?.fare_difference != null ? String(ticket.fare_difference) : "",
  }
}

// The portion of sell/purchase price that predates this reissue's fee/fare terms —
// derived by backing the current fee/fare fields out of the stored prices.
function baseSellPrice(ticket) {
  return (ticket?.sell_price ?? 0) - (ticket?.fare_difference ?? 0) - (ticket?.reissue_fee_collected ?? 0)
}

function basePurchasePrice(ticket) {
  return (ticket?.purchase_price ?? 0) - (ticket?.fare_difference ?? 0) - (ticket?.reissue_fee_paid ?? 0)
}

export default function EditReissueModal({ isOpen, onClose, ticket, onSaved }) {
  const [form, setForm] = useState(() => buildForm(ticket))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (isOpen) {
      setForm(buildForm(ticket))
      setError("")
    }
  }, [isOpen, ticket])

  if (!isOpen) return null

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const fareDiff = parseFloat(form.fare_difference) || 0
  const feeCollected = parseFloat(form.reissue_fee_collected) || 0
  const feePaid = parseFloat(form.reissue_fee_paid) || 0

  const computedSellPrice = baseSellPrice(ticket) + fareDiff + feeCollected
  const computedPurchasePrice = basePurchasePrice(ticket) + fareDiff + feePaid
  const reissueProfit = feeCollected - feePaid

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    const updates = {
      reissue_fee_collected: form.reissue_fee_collected !== "" ? parseFloat(form.reissue_fee_collected) : null,
      reissue_fee_paid: form.reissue_fee_paid !== "" ? parseFloat(form.reissue_fee_paid) : null,
      fare_difference: form.fare_difference !== "" ? parseFloat(form.fare_difference) : null,
      sell_price: computedSellPrice,
      purchase_price: computedPurchasePrice,
      office_markup: ticket.gds_price != null ? computedPurchasePrice - ticket.gds_price : null,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 px-4 py-6" onMouseDown={handleBackdrop}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Edit Reissue Details</h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form id="edit-reissue-form" onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Purchase Price</label>
                <div className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-gray-100 tabular-nums">
                  {computedPurchasePrice.toLocaleString("en-BD")}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sell Price</label>
                <div className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-gray-100 tabular-nums">
                  {computedSellPrice.toLocaleString("en-BD")}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">Prices recompute live from the fields below</p>

            <div className="grid grid-cols-3 gap-3 pt-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reissue Fee Collected</label>
                <input type="number" min="0" step="0.01" value={form.reissue_fee_collected} onChange={set("reissue_fee_collected")} placeholder="0.00" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reissue Fee Paid</label>
                <input type="number" min="0" step="0.01" value={form.reissue_fee_paid} onChange={set("reissue_fee_paid")} placeholder="0.00" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fare Difference</label>
                <input type="number" step="0.01" value={form.fare_difference} onChange={set("fare_difference")} placeholder="0.00" className={inputCls} />
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Profit From Reissue:{" "}
              <span className={`font-medium ${reissueProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {reissueProfit.toLocaleString("en-BD")}
              </span>
            </p>
          </form>
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
            type="submit"
            form="edit-reissue-form"
            disabled={loading}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  )
}
