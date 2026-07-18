import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { blockNonNumericKeys } from "../../lib/numberInput"

function buildForm(ticket) {
  return {
    passenger_name: ticket?.passenger_name ?? "",
    // Carrier, client, supplier are carried over from the original ticket
    // as-is — this modal deliberately doesn't offer them for re-selection
    // (a reissue is virtually always the same passenger/client/supplier/
    // airline as the ticket it's reissuing). Use the normal ticket Edit
    // action on the new child ticket afterward for the rare case where one
    // of these actually needs to change.
    carrier: ticket?.carrier ?? "",
    client_id: ticket?.client_id ?? "",
    supplier_id: ticket?.supplier_id ?? "",
    ticket_number: "",
    pnr: ticket?.pnr ?? "",
    route: ticket?.route ?? "",
    issue_date: ticket?.issue_date ?? "",
    travel_date: ticket?.travel_date ?? "",
    return_date: ticket?.return_date ?? "",
    orig_sell_price: ticket?.sell_price ?? 0,
    orig_purchase_price: ticket?.purchase_price ?? 0,
    // Blank, not pre-filled from the parent — gds_price is this reissue's
    // own informational supplier cost (the GDS transaction for the fare
    // change itself), not the original ticket's full GDS price.
    gds_price: "",
    narration: "",
    // Breakdown fields. Airlines Penalty and Fare Difference are pass-
    // throughs — charged to the client and owed to the supplier equally,
    // zero margin impact on their own. Reissue Margin and Commission are
    // the two levers that actually generate profit.
    airlines_penalty: "",
    fare_difference: "",
    reissue_margin: "",
    commission: "",
    // Direct-entry price fields — start blank and, until the agent types
    // into them directly, mirror whatever the breakdown fields below imply
    // (see sellPriceDirty/purchasePriceDirty/commissionDirty).
    sell_price: "",
    purchase_price: "",
  }
}

export default function ReissueModal({ isOpen, onClose, ticket, onSaved }) {
  const { agent } = useAuth()
  const [form, setForm] = useState(() => buildForm(ticket))
  // Tracks whether the agent has typed into Sell Price / Purchase Price
  // directly. Until they do, the field mirrors the breakdown fields live;
  // the instant they touch it by hand, it detaches and becomes theirs —
  // the breakdown keeps computing its own implied total in the background
  // (for the mismatch hint below) but stops overwriting the price field.
  const [sellPriceDirty, setSellPriceDirty] = useState(false)
  const [purchasePriceDirty, setPurchasePriceDirty] = useState(false)
  const [commissionDirty, setCommissionDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!isOpen) return
    setError("")
    setForm(buildForm(ticket))
    setSellPriceDirty(false)
    setPurchasePriceDirty(false)
    setCommissionDirty(false)
  }, [isOpen, ticket])

  if (!isOpen) return null

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const airlinesPenalty = parseFloat(form.airlines_penalty) || 0
  const fareDiff         = parseFloat(form.fare_difference)  || 0
  const reissueMargin     = parseFloat(form.reissue_margin)  || 0

  // Commission earned on the fare-difference booking — the same
  // detach-on-manual-edit pattern as Sell/Purchase Price below.
  const autoCommission = Math.round(fareDiff * 0.07 * 100) / 100
  const commission = commissionDirty ? (parseFloat(form.commission) || 0) : autoCommission

  // What the breakdown fields alone imply. Airlines Penalty and Fare
  // Difference are pass-throughs, added identically to both sides — not
  // the original ticket's price rolled forward: the original sale was
  // already recognized as revenue on the parent ticket when it was first
  // booked, so re-including it here would double-count it every time a
  // ticket is reissued. Reissue Margin and Commission are what actually
  // shift the margin: margin adds to Sell Price only, commission reduces
  // Purchase Price only.
  const breakdownSellPrice     = airlinesPenalty + reissueMargin + fareDiff
  const breakdownPurchasePrice = airlinesPenalty + fareDiff - commission

  // The value that actually gets saved: whatever the agent typed directly
  // once they've touched the field, otherwise the live breakdown total.
  const sellPrice     = sellPriceDirty     ? (parseFloat(form.sell_price)     || 0) : breakdownSellPrice
  const purchasePrice = purchasePriceDirty ? (parseFloat(form.purchase_price) || 0) : breakdownPurchasePrice

  const setSellPrice = (e) => {
    setSellPriceDirty(true)
    setForm((f) => ({ ...f, sell_price: e.target.value }))
  }
  const setPurchasePrice = (e) => {
    setPurchasePriceDirty(true)
    setForm((f) => ({ ...f, purchase_price: e.target.value }))
  }
  const setCommission = (e) => {
    setCommissionDirty(true)
    setForm((f) => ({ ...f, commission: e.target.value }))
  }
  const resyncSellPrice = () => setSellPriceDirty(false)
  const resyncPurchasePrice = () => setPurchasePriceDirty(false)
  const resyncCommission = () => setCommissionDirty(false)

  // Reference only, never stored — lets the agent see what the client's
  // ticket is now cumulatively worth across the whole reissue chain so far,
  // using whichever sell price actually ends up being saved.
  const newTicketTotal = (form.orig_sell_price || 0) + sellPrice

  // Always the real entered/computed numbers, regardless of which entry
  // mode was used for either side.
  const reissueProfit = sellPrice - purchasePrice

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    const gdsPrice = form.gds_price !== "" ? parseFloat(form.gds_price) : null

    const childPayload = {
      agent_id: agent.id,
      passenger_name: form.passenger_name.trim(),
      carrier: form.carrier.trim(),
      ticket_number: form.ticket_number.trim() || null,
      pnr: form.pnr.trim().toUpperCase(),
      route: form.route.trim(),
      issue_date: form.issue_date || null,
      travel_date: form.travel_date,
      return_date: form.return_date || null,
      client_id: form.client_id || null,
      supplier_id: form.supplier_id || null,
      purchase_price: purchasePrice,
      gds_price: gdsPrice,
      office_markup: gdsPrice !== null ? purchasePrice - gdsPrice : null,
      sell_price: sellPrice,
      status: "booked",
      narration: form.narration.trim() || null,
      parent_ticket_id: ticket.id,
      is_reissue: true,
      airlines_penalty: form.airlines_penalty !== "" ? parseFloat(form.airlines_penalty) : null,
      fare_difference: form.fare_difference !== "" ? parseFloat(form.fare_difference) : null,
      reissue_margin: form.reissue_margin !== "" ? parseFloat(form.reissue_margin) : null,
      // Persist the resolved commission (auto-calculated or manually
      // overridden) whenever either field was touched, so the saved value
      // always matches what actually fed into purchase_price — not just
      // whatever the agent may or may not have typed directly.
      commission: form.fare_difference !== "" || form.commission !== "" ? commission : null,
    }

    // Mark original ticket as reissued
    const { error: parentErr } = await supabase
      .from("tickets")
      .update({ status: "reissued" })
      .eq("id", ticket.id)

    if (parentErr) {
      setError(parentErr.message)
      setLoading(false)
      return
    }

    // Create the new child ticket
    const { data: child, error: childErr } = await supabase
      .from("tickets")
      .insert(childPayload)
      .select(`*, clients(name), suppliers(name)`)
      .single()

    if (childErr) {
      setError(childErr.message)
      setLoading(false)
      return
    }

    setLoading(false)
    onSaved({ parentId: ticket.id, child })
    onClose()
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 px-4 py-6"
      onMouseDown={handleBackdrop}
    >
      <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Reissue ticket</h2>
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

          <form id="reissue-form" onSubmit={handleSubmit} className="space-y-5">
            {/* Passenger */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Passenger</legend>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Passenger Name <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input type="text" required value={form.passenger_name} onChange={set("passenger_name")} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ticket Number</label>
                  <input type="text" value={form.ticket_number} onChange={set("ticket_number")} placeholder="e.g. 996-1234567890" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    PNR <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input type="text" required value={form.pnr} onChange={set("pnr")} placeholder="e.g. ABC123" className={inputCls} />
                </div>
              </div>
            </fieldset>

            {/* Travel */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Travel</legend>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Route <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input type="text" required value={form.route} onChange={set("route")} placeholder="e.g. DAC-DXB" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Issue Date</label>
                  <input type="date" value={form.issue_date} onChange={set("issue_date")} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Travel Date <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input type="date" required value={form.travel_date} onChange={set("travel_date")} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Return Date</label>
                  <input type="date" value={form.return_date} onChange={set("return_date")} className={inputCls} />
                </div>
              </div>
            </fieldset>

            {/* Reissue Details — optional breakdown. Filling these in drives
                Sell Price / Purchase Price below live, until you edit one of
                those directly. Grouped by which side each field feeds:
                Airlines Penalty and Fare Difference are pass-throughs that
                hit both sides equally; Reissue Margin and Commission are
                the two fields that actually move the margin, one on each
                side. */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Reissue Details (optional breakdown)</legend>

              <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Feeds both</p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Airlines Penalty</label>
                  <input type="number" onKeyDown={blockNonNumericKeys} min="0" step="0.01" value={form.airlines_penalty} onChange={set("airlines_penalty")} placeholder="0.00" className={inputCls} />
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Change fee charged by the airline — passed through to the client and owed to the supplier equally</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fare Difference</label>
                  <input type="number" onKeyDown={blockNonNumericKeys} step="0.01" value={form.fare_difference} onChange={set("fare_difference")} placeholder="0.00" className={inputCls} />
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Price difference between old and new fare — can be negative</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
                  <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Feeds Sell Price</p>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reissue Margin</label>
                  <input type="number" onKeyDown={blockNonNumericKeys} min="0" step="0.01" value={form.reissue_margin} onChange={set("reissue_margin")} placeholder="0.00" className={inputCls} />
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">What you charge on top, beyond the pass-through costs</p>
                </div>
                <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
                  <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Feeds Purchase Price</p>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Commission</label>
                  <input
                    type="number" onKeyDown={blockNonNumericKeys}
                    step="0.01"
                    value={commissionDirty ? form.commission : String(autoCommission)}
                    onChange={setCommission}
                    placeholder="0.00"
                    className={inputCls}
                  />
                  {commissionDirty && commission !== autoCommission ? (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      Auto-calc (7% of Fare Difference) suggests {autoCommission.toLocaleString("en-BD")} — differs by {Math.abs(commission - autoCommission).toLocaleString("en-BD")}.{" "}
                      <button type="button" onClick={resyncCommission} className="underline hover:no-underline">
                        Use {autoCommission.toLocaleString("en-BD")} instead
                      </button>
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Auto: 7% of Fare Difference — earned back, deducted from Purchase Price</p>
                  )}
                </div>
              </div>
            </fieldset>

            {/* Financials — Sell Price / Purchase Price are always directly
                editable. If the breakdown above is filled in, they start out
                mirroring it live; typing into either price field directly
                detaches it from the breakdown from that point on (order
                doesn't matter — whichever you touch by hand wins). */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Financials</legend>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div className="space-y-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Purchase Price (this reissue)</label>
                    <input
                      type="number" onKeyDown={blockNonNumericKeys}
                      min="0"
                      step="0.01"
                      value={purchasePriceDirty ? form.purchase_price : String(breakdownPurchasePrice)}
                      onChange={setPurchasePrice}
                      placeholder="0.00"
                      className={inputCls}
                    />
                    {purchasePriceDirty && purchasePrice !== breakdownPurchasePrice ? (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        Breakdown implies {breakdownPurchasePrice.toLocaleString("en-BD")} — differs by {Math.abs(purchasePrice - breakdownPurchasePrice).toLocaleString("en-BD")}.{" "}
                        <button type="button" onClick={resyncPurchasePrice} className="underline hover:no-underline">
                          Use {breakdownPurchasePrice.toLocaleString("en-BD")} instead
                        </button>
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">This reissue's own cost — not the original ticket's price. Enter directly, or fill in the breakdown below.</p>
                    )}
                  </div>
                  <div className="pl-3 border-l-2 border-gray-100 dark:border-gray-800">
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Supplier Purchase Price</label>
                    <input type="number" onKeyDown={blockNonNumericKeys} min="0" step="0.01" value={form.gds_price} onChange={set("gds_price")} placeholder="0.00" className={inputCls} />
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Informational only</p>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sell Price (this reissue)</label>
                  <input
                    type="number" onKeyDown={blockNonNumericKeys}
                    min="0"
                    step="0.01"
                    value={sellPriceDirty ? form.sell_price : String(breakdownSellPrice)}
                    onChange={setSellPrice}
                    placeholder="0.00"
                    className={inputCls}
                  />
                  {sellPriceDirty && sellPrice !== breakdownSellPrice ? (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      Breakdown implies {breakdownSellPrice.toLocaleString("en-BD")} — differs by {Math.abs(sellPrice - breakdownSellPrice).toLocaleString("en-BD")}.{" "}
                      <button type="button" onClick={resyncSellPrice} className="underline hover:no-underline">
                        Use {breakdownSellPrice.toLocaleString("en-BD")} instead
                      </button>
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">What this reissue itself charges the client. Enter directly, or fill in the breakdown below.</p>
                  )}
                </div>
              </div>
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                Profit From Reissue:{" "}
                <span className={`font-medium ${reissueProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {reissueProfit.toLocaleString("en-BD")}
                </span>
              </p>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Reference only, not stored — new ticket total across the whole reissue chain so far:{" "}
                <span className="font-medium text-gray-600 dark:text-gray-400 tabular-nums">{newTicketTotal.toLocaleString("en-BD")}</span>
              </p>
            </fieldset>

            {/* Notes */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Notes</legend>
              <textarea value={form.narration} onChange={set("narration")} placeholder="Any notes about this ticket…" rows={3} className={`${inputCls} resize-none`} />
            </fieldset>
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
            form="reissue-form"
            disabled={loading}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Saving…" : "Reissue ticket"}
          </button>
        </div>
      </div>
    </div>
  )
}
