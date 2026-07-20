import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { blockNonNumericKeys } from "../../lib/numberInput"
import { logActivity } from "../../lib/activityLog"

function fmt(n) {
  return Number(n ?? 0).toLocaleString("en-BD")
}

function buildForm(ticket) {
  return {
    airlines_penalty: ticket?.airlines_penalty != null ? String(ticket.airlines_penalty) : "",
    fare_difference: ticket?.fare_difference != null ? String(ticket.fare_difference) : "",
    reissue_margin: ticket?.reissue_margin != null ? String(ticket.reissue_margin) : "",
    commission: ticket?.commission != null ? String(ticket.commission) : "",
  }
}

export default function EditReissueModal({ isOpen, onClose, ticket, onSaved }) {
  const { agent } = useAuth()
  const [form, setForm] = useState(() => buildForm(ticket))
  // Commission starts "dirty" whenever the ticket already has a stored
  // value — otherwise re-opening this modal on an existing reissue would
  // silently replace a previously-overridden commission with the 7%
  // auto-calc the moment fare_difference gets touched.
  const [commissionDirty, setCommissionDirty] = useState(() => ticket?.commission != null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (isOpen) {
      setForm(buildForm(ticket))
      setCommissionDirty(ticket?.commission != null)
      setError("")
    }
  }, [isOpen, ticket])

  if (!isOpen) return null

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const airlinesPenalty = parseFloat(form.airlines_penalty) || 0
  const fareDiff         = parseFloat(form.fare_difference)  || 0
  const reissueMargin     = parseFloat(form.reissue_margin)  || 0

  const autoCommission = Math.round(fareDiff * 0.07 * 100) / 100
  const commission = commissionDirty ? (parseFloat(form.commission) || 0) : autoCommission

  const setCommission = (e) => {
    setCommissionDirty(true)
    setForm((f) => ({ ...f, commission: e.target.value }))
  }
  const resyncCommission = () => setCommissionDirty(false)

  // This reissue's own sell/purchase price — pass-throughs (Airlines
  // Penalty, Fare Difference) plus the two margin levers (Reissue Margin
  // on the sell side, Commission deducted on the purchase side). Not the
  // original ticket's price rolled forward (see ReissueModal for why).
  const computedSellPrice = airlinesPenalty + reissueMargin + fareDiff
  const computedPurchasePrice = airlinesPenalty + fareDiff - commission
  const reissueProfit = computedSellPrice - computedPurchasePrice

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    const updates = {
      airlines_penalty: form.airlines_penalty !== "" ? parseFloat(form.airlines_penalty) : null,
      fare_difference: form.fare_difference !== "" ? parseFloat(form.fare_difference) : null,
      reissue_margin: form.reissue_margin !== "" ? parseFloat(form.reissue_margin) : null,
      commission: form.fare_difference !== "" || form.commission !== "" ? commission : null,
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

    if (ticket.sell_price !== computedSellPrice || ticket.purchase_price !== computedPurchasePrice) {
      logActivity({
        agentId: agent.id,
        ticketId: ticket.id,
        eventType: "reissue_edited",
        description:
          `Reissue details edited — sell_price ${fmt(ticket.sell_price)} → ${fmt(computedSellPrice)}, ` +
          `purchase_price ${fmt(ticket.purchase_price)} → ${fmt(computedPurchasePrice)}`,
        metadata: {
          before: { sell_price: ticket.sell_price, purchase_price: ticket.purchase_price },
          after: { sell_price: computedSellPrice, purchase_price: computedPurchasePrice },
        },
      })
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Purchase Price (this reissue)</label>
                <div className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-gray-100 tabular-nums">
                  {computedPurchasePrice.toLocaleString("en-BD")}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sell Price (this reissue)</label>
                <div className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-gray-100 tabular-nums">
                  {computedSellPrice.toLocaleString("en-BD")}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">This reissue's own price — recomputed live from the fields below</p>

            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide pt-2">Feeds both</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Airlines Penalty</label>
                <input type="number" onKeyDown={blockNonNumericKeys} min="0" step="0.01" value={form.airlines_penalty} onChange={set("airlines_penalty")} placeholder="0.00" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fare Difference</label>
                <input type="number" onKeyDown={blockNonNumericKeys} step="0.01" value={form.fare_difference} onChange={set("fare_difference")} placeholder="0.00" className={inputCls} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div>
                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">Feeds Sell Price</p>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reissue Margin</label>
                <input type="number" onKeyDown={blockNonNumericKeys} min="0" step="0.01" value={form.reissue_margin} onChange={set("reissue_margin")} placeholder="0.00" className={inputCls} />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">Feeds Purchase Price</p>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Commission</label>
                <input
                  type="number" onKeyDown={blockNonNumericKeys}
                  step="0.01"
                  value={commissionDirty ? form.commission : String(autoCommission)}
                  onChange={setCommission}
                  placeholder="0.00"
                  className={inputCls}
                />
                {commissionDirty && commission !== autoCommission && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    Auto-calc suggests {autoCommission.toLocaleString("en-BD")}.{" "}
                    <button type="button" onClick={resyncCommission} className="underline hover:no-underline">
                      Use it
                    </button>
                  </p>
                )}
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
