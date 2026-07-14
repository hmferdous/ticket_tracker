import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { AIRLINES } from "../../lib/airlines"
import SearchableDropdown from "../ui/SearchableDropdown"
import SearchableEntityDropdown from "../ui/SearchableEntityDropdown"
import { fetchChannels } from "../../lib/channels"
import { clientEffectiveTarget } from "../../lib/refunds"

function derivePaymentStatus(amountPaid, target) {
  if (amountPaid <= 0) return "unpaid"
  if (amountPaid >= target) return "paid"
  return "partial"
}

const AIRLINE_OPTIONS = AIRLINES.map((a) => ({
  value: a.code,
  label: `${a.code} — ${a.name}`,
}))

const EMPTY_PAYMENT = { amount: "", channel_id: "", trx_id: "", notes: "", paid_in_full: false }

function buildForm(ticket) {
  return {
    passenger_name: ticket?.passenger_name ?? "",
    carrier: ticket?.carrier ?? "",
    ticket_number: "",
    pnr: ticket?.pnr ?? "",
    route: ticket?.route ?? "",
    issue_date: ticket?.issue_date ?? "",
    travel_date: ticket?.travel_date ?? "",
    return_date: ticket?.return_date ?? "",
    client_id: ticket?.client_id ?? "",
    supplier_id: ticket?.supplier_id ?? "",
    orig_sell_price: ticket?.sell_price ?? 0,
    orig_purchase_price: ticket?.purchase_price ?? 0,
    gds_price: ticket?.gds_price ?? "",
    narration: "",
    reissue_fee_collected: "",
    reissue_fee_paid: "",
    fare_difference: "",
  }
}

export default function ReissueModal({ isOpen, onClose, ticket, onSaved }) {
  const { agent } = useAuth()
  const [form, setForm] = useState(() => buildForm(ticket))
  const [clients, setClients] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [channels, setChannels] = useState([])
  const [clientPay, setClientPay] = useState(EMPTY_PAYMENT)
  const [clientPayOpen, setClientPayOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!isOpen) return
    setError("")
    setForm(buildForm(ticket))
    setClientPay(EMPTY_PAYMENT)
    setClientPayOpen(false)
    fetchDropdowns()
  }, [isOpen, ticket])

  const fetchDropdowns = async () => {
    const [{ data: c }, { data: s }, { data: ch }] = await Promise.all([
      supabase.from("clients").select("id, name").eq("agent_id", agent.id).order("name"),
      supabase.from("suppliers").select("id, name").eq("agent_id", agent.id).order("name"),
      fetchChannels(agent.id),
    ])
    setClients(c ?? [])
    setSuppliers(s ?? [])
    setChannels(ch ?? [])
  }

  if (!isOpen) return null

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  const setC = (field) => (e) => setClientPay((p) => ({ ...p, [field]: e.target.value }))

  const handlePaidInFull = (e) => {
    setClientPay((p) => ({ ...p, paid_in_full: e.target.checked, amount: e.target.checked ? "" : p.amount }))
  }

  const handleAddNewClient = async (name) => {
    const { data } = await supabase
      .from("clients")
      .insert({ name, agent_id: agent.id })
      .select("id, name")
      .single()
    if (data) {
      setClients((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setForm((f) => ({ ...f, client_id: data.id }))
    }
  }

  const handleAddNewSupplier = async (name) => {
    const { data } = await supabase
      .from("suppliers")
      .insert({ name, agent_id: agent.id })
      .select("id, name")
      .single()
    if (data) {
      setSuppliers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setForm((f) => ({ ...f, supplier_id: data.id }))
    }
  }

  const fareDiff      = parseFloat(form.fare_difference)      || 0
  const feeCollected  = parseFloat(form.reissue_fee_collected) || 0
  const feePaid       = parseFloat(form.reissue_fee_paid)      || 0

  const computedSellPrice     = (form.orig_sell_price     || 0) + fareDiff + feeCollected
  const computedPurchasePrice = (form.orig_purchase_price || 0) + fareDiff + feePaid

  const reissueProfit = feeCollected - feePaid

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
      purchase_price: computedPurchasePrice,
      gds_price: gdsPrice,
      office_markup: gdsPrice !== null ? computedPurchasePrice - gdsPrice : null,
      sell_price: computedSellPrice,
      status: "booked",
      narration: form.narration.trim() || null,
      parent_ticket_id: ticket.id,
      is_reissue: true,
      reissue_fee_collected: form.reissue_fee_collected !== "" ? parseFloat(form.reissue_fee_collected) : null,
      reissue_fee_paid: form.reissue_fee_paid !== "" ? parseFloat(form.reissue_fee_paid) : null,
      fare_difference: form.fare_difference !== "" ? parseFloat(form.fare_difference) : null,
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

    // Optional client payment on the new ticket — same as ticket form
    const clientAmount = clientPay.paid_in_full ? computedSellPrice : parseFloat(clientPay.amount)
    if (clientAmount > 0) {
      const today = new Date().toISOString().split("T")[0]
      const selectedChannel = channels.find((c) => c.id === clientPay.channel_id)
      const { data: payRow, error: payErr } = await supabase
        .from("payments")
        .insert({
          agent_id: agent.id,
          client_id: child.client_id,
          type: "client_payment",
          amount: clientAmount,
          unallocated_amount: 0,
          channel: selectedChannel?.name ?? null,
          channel_id: clientPay.channel_id || null,
          trx_id: clientPay.trx_id.trim() || null,
          notes: clientPay.notes.trim() || null,
          payment_date: today,
        })
        .select("id")
        .single()

      if (!payErr && payRow) {
        await supabase.from("ticket_payments").insert({
          payment_id: payRow.id,
          ticket_id: child.id,
          allocated_amount: clientAmount,
          type: "client",
        })

        const newAmountPaid = (child.amount_paid ?? 0) + clientAmount
        const newPaymentStatus = derivePaymentStatus(newAmountPaid, clientEffectiveTarget(child))
        await supabase
          .from("tickets")
          .update({ amount_paid: newAmountPaid, payment_status: newPaymentStatus })
          .eq("id", child.id)
        child.amount_paid = newAmountPaid
        child.payment_status = newPaymentStatus
      }
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
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Passenger Name <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input type="text" required value={form.passenger_name} onChange={set("passenger_name")} className={inputCls} />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Carrier <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <SearchableDropdown
                    options={AIRLINE_OPTIONS}
                    value={form.carrier}
                    onChange={(val) => setForm((f) => ({ ...f, carrier: val }))}
                    placeholder="Search airline or code…"
                    allowCustom={true}
                  />
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

            {/* Links */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Links</legend>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Client</label>
                  <SearchableEntityDropdown
                    entities={clients}
                    value={form.client_id}
                    onChange={(id) => setForm((f) => ({ ...f, client_id: id }))}
                    placeholder="Search client…"
                    onAddNew={handleAddNewClient}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Supplier</label>
                  <SearchableEntityDropdown
                    entities={suppliers}
                    value={form.supplier_id}
                    onChange={(id) => setForm((f) => ({ ...f, supplier_id: id }))}
                    placeholder="Search supplier…"
                    onAddNew={handleAddNewSupplier}
                  />
                </div>
              </div>
            </fieldset>

            {/* Financials */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Financials</legend>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div className="space-y-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Purchase Price</label>
                    <div className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-gray-100 tabular-nums">
                      {computedPurchasePrice.toLocaleString("en-BD")}
                    </div>
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Auto-computed from original + fare diff + reissue fee paid</p>
                  </div>
                  <div className="pl-3 border-l-2 border-gray-100 dark:border-gray-800">
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Supplier Purchase Price</label>
                    <input type="number" min="0" step="0.01" value={form.gds_price} onChange={set("gds_price")} placeholder="0.00" className={inputCls} />
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Informational only</p>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sell Price</label>
                  <div className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-gray-100 tabular-nums">
                    {computedSellPrice.toLocaleString("en-BD")}
                  </div>
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Auto-computed from original + fare diff + reissue fee collected</p>
                </div>
              </div>
            </fieldset>

            {/* Reissue Details */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Reissue Details</legend>
              <div className="grid grid-cols-3 gap-3">
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
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                Profit From Reissue:{" "}
                <span className={`font-medium ${reissueProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {reissueProfit.toLocaleString("en-BD")}
                </span>
              </p>
            </fieldset>

            {/* Notes */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Notes</legend>
              <textarea value={form.narration} onChange={set("narration")} placeholder="Any notes about this ticket…" rows={3} className={`${inputCls} resize-none`} />
            </fieldset>

            {/* Client Payment — collapsible */}
            <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setClientPayOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors"
              >
                <span>Record Payment</span>
                <svg className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform ${clientPayOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {clientPayOpen && (
                <div className="px-4 py-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount Received</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={clientPay.paid_in_full ? computedSellPrice : clientPay.amount}
                        onChange={setC("amount")}
                        disabled={clientPay.paid_in_full}
                        placeholder="0.00"
                        className={`${inputCls} ${clientPay.paid_in_full ? "bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400" : ""}`}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Channel</label>
                      <select value={clientPay.channel_id} onChange={setC("channel_id")} className={inputCls}>
                        <option value="">— Select —</option>
                        {channels.map((ch) => (
                          <option key={ch.id} value={ch.id}>{ch.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Transaction ID</label>
                    <input type="text" value={clientPay.trx_id} onChange={setC("trx_id")} placeholder="Reference or TrxID" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
                    <input type="text" value={clientPay.notes} onChange={setC("notes")} placeholder="Optional note" className={inputCls} />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
                    <input type="checkbox" checked={clientPay.paid_in_full} onChange={handlePaidInFull} className="rounded border-gray-300 dark:border-gray-700 text-blue-600 dark:text-blue-400 focus:ring-blue-500" />
                    Paid in full (fills sell price)
                  </label>
                </div>
              )}
            </div>
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
