import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"

const STATUSES = ["booked", "collected", "supplier_paid", "flown", "closed"]

const EMPTY = {
  passenger_name: "",
  carrier: "",
  ticket_number: "",
  pnr: "",
  route: "",
  travel_date: "",
  return_date: "",
  client_id: "",
  supplier_id: "",
  purchase_price: "",
  sell_price: "",
  reported_price: "",
  status: "booked",
  narration: "",
}

export default function TicketModal({ isOpen, onClose, onSaved, ticket }) {
  const { agent } = useAuth()
  const [form, setForm] = useState(EMPTY)
  const [clients, setClients] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!isOpen) return
    setError("")
    setForm(
      ticket
        ? {
            passenger_name: ticket.passenger_name ?? "",
            carrier: ticket.carrier ?? "",
            ticket_number: ticket.ticket_number ?? "",
            pnr: ticket.pnr ?? "",
            route: ticket.route ?? "",
            travel_date: ticket.travel_date ?? "",
            return_date: ticket.return_date ?? "",
            client_id: ticket.client_id ?? "",
            supplier_id: ticket.supplier_id ?? "",
            purchase_price: ticket.purchase_price ?? "",
            sell_price: ticket.sell_price ?? "",
            reported_price: ticket.reported_price ?? "",
            status: ticket.status ?? "booked",
            narration: ticket.narration ?? "",
          }
        : EMPTY
    )
    fetchDropdowns()
  }, [isOpen, ticket])

  const fetchDropdowns = async () => {
    const [{ data: c }, { data: s }] = await Promise.all([
      supabase.from("clients").select("id, name").eq("agent_id", agent.id).order("name"),
      supabase.from("suppliers").select("id, name").eq("agent_id", agent.id).order("name"),
    ])
    setClients(c ?? [])
    setSuppliers(s ?? [])
  }

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    const payload = {
      passenger_name: form.passenger_name.trim(),
      carrier: form.carrier.trim(),
      ticket_number: form.ticket_number.trim() || null,
      pnr: form.pnr.trim() || null,
      route: form.route.trim(),
      travel_date: form.travel_date,
      return_date: form.return_date || null,
      client_id: form.client_id || null,
      supplier_id: form.supplier_id || null,
      purchase_price: parseFloat(form.purchase_price),
      sell_price: parseFloat(form.sell_price),
      reported_price: form.reported_price !== "" ? parseFloat(form.reported_price) : null,
      status: form.status,
      narration: form.narration.trim() || null,
    }

    let result
    if (ticket?.id) {
      result = await supabase
        .from("tickets")
        .update(payload)
        .eq("id", ticket.id)
        .select(`*, clients(name), suppliers(name)`)
        .single()
    } else {
      result = await supabase
        .from("tickets")
        .insert({ ...payload, agent_id: agent.id })
        .select(`*, clients(name), suppliers(name)`)
        .single()
    }

    setLoading(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    onSaved(result.data)
    onClose()
  }

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      onMouseDown={handleBackdrop}
    >
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            {ticket ? "Edit ticket" : "Add ticket"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form id="ticket-form" onSubmit={handleSubmit} className="space-y-5">
            {/* Passenger info */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Passenger</legend>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Passenger Name <span className="text-red-500">*</span>
                  </label>
                  <input type="text" required value={form.passenger_name} onChange={set("passenger_name")} placeholder="Full name" className={inputCls} />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Carrier <span className="text-red-500">*</span>
                  </label>
                  <input type="text" required value={form.carrier} onChange={set("carrier")} placeholder="e.g. Biman, Emirates" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ticket Number</label>
                  <input type="text" value={form.ticket_number} onChange={set("ticket_number")} placeholder="e.g. 996-1234567890" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">PNR</label>
                  <input type="text" value={form.pnr} onChange={set("pnr")} placeholder="e.g. ABC123" className={inputCls} />
                </div>
              </div>
            </fieldset>

            {/* Travel info */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Travel</legend>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Route <span className="text-red-500">*</span>
                  </label>
                  <input type="text" required value={form.route} onChange={set("route")} placeholder="e.g. DAC-DXB" className={inputCls} />
                </div>
                <div />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Travel Date <span className="text-red-500">*</span>
                  </label>
                  <input type="date" required value={form.travel_date} onChange={set("travel_date")} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Return Date</label>
                  <input type="date" value={form.return_date} onChange={set("return_date")} className={inputCls} />
                </div>
              </div>
            </fieldset>

            {/* Client & Supplier */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Links</legend>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
                  <select value={form.client_id} onChange={set("client_id")} className={inputCls}>
                    <option value="">— None —</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                  <select value={form.supplier_id} onChange={set("supplier_id")} className={inputCls}>
                    <option value="">— None —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </fieldset>

            {/* Financials */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Financials</legend>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Purchase Price <span className="text-red-500">*</span>
                  </label>
                  <input type="number" required min="0" step="0.01" value={form.purchase_price} onChange={set("purchase_price")} placeholder="0.00" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Sell Price <span className="text-red-500">*</span>
                  </label>
                  <input type="number" required min="0" step="0.01" value={form.sell_price} onChange={set("sell_price")} placeholder="0.00" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reported Price</label>
                  <input type="number" min="0" step="0.01" value={form.reported_price} onChange={set("reported_price")} placeholder="0.00" className={inputCls} />
                </div>
              </div>
            </fieldset>

            {/* Status & narration */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Status & Notes</legend>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select value={form.status} onChange={set("status")} className={inputCls}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Narration</label>
                  <textarea value={form.narration} onChange={set("narration")} placeholder="Any notes about this ticket…" rows={3} className={`${inputCls} resize-none`} />
                </div>
              </div>
            </fieldset>
          </form>
        </div>

        {/* Footer */}
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
            form="ticket-form"
            disabled={loading}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Saving…" : ticket ? "Save changes" : "Add ticket"}
          </button>
        </div>
      </div>
    </div>
  )
}
