import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { AIRLINES } from "../../lib/airlines"
import SearchableDropdown from "../ui/SearchableDropdown"
import SearchableEntityDropdown from "../ui/SearchableEntityDropdown"
import { fetchChannels } from "../../lib/channels"
import { clientEffectiveTarget } from "../../lib/refunds"
import { blockNonNumericKeys } from "../../lib/numberInput"
import { logActivity } from "../../lib/activityLog"

function derivePaymentStatus(amountPaid, target) {
  if (amountPaid <= 0) return "unpaid"
  if (amountPaid >= target) return "paid"
  return "partial"
}

function fmt(n) {
  return Number(n ?? 0).toLocaleString("en-BD")
}

export async function createClient(supabase, agentId, name, extra = {}) {
  const { data, error } = await supabase
    .from("clients")
    .insert({ agent_id: agentId, name, ...extra })
    .select("id, name, client_id_number")
    .single()

  if (error) throw error
  return data
}

export async function createSupplier(supabase, agentId, name, extra = {}) {
  const { data, error } = await supabase
    .from("suppliers")
    .insert({ agent_id: agentId, name, ...extra })
    .select("id, name, supplier_id_number")
    .single()

  if (error) throw error
  return data
}

const AIRLINE_OPTIONS = AIRLINES.map((a) => ({
  value: a.code,
  label: `${a.code} — ${a.name}`,
}))

const EMPTY = {
  passenger_name: "",
  carrier: "",
  ticket_number: "",
  pnr: "",
  route: "",
  issue_date: "",
  travel_date: "",
  return_date: "",
  client_id: "",
  supplier_id: "",
  purchase_price: "",
  gds_price: "",
  sell_price: "",
  status: "booked",  // not shown in form; preserved on edit, defaulted to booked on add
  narration: "",
}

const EMPTY_PAYMENT = { amount: "", channel_id: "", trx_id: "", notes: "", paid_in_full: false, payment_date: "" }

export default function TicketModal({ isOpen, onClose, onSaved, ticket, cloneMode = false }) {
  const { agent } = useAuth()
  const [form, setForm] = useState(EMPTY)
  const [clients, setClients] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [channels, setChannels] = useState([])
  const [clientPay, setClientPay] = useState(EMPTY_PAYMENT)
  const [supplierPay, setSupplierPay] = useState(EMPTY_PAYMENT)
  const [clientPayOpen, setClientPayOpen] = useState(false)
  const [supplierPayOpen, setSupplierPayOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!isOpen) return
    setError("")
    setClientPay(EMPTY_PAYMENT)
    setSupplierPay(EMPTY_PAYMENT)
    setClientPayOpen(false)
    setSupplierPayOpen(false)
    setForm(
      ticket
        ? {
            passenger_name: ticket.passenger_name ?? "",
            carrier: ticket.carrier ?? "",
            ticket_number: ticket.ticket_number ?? "",
            pnr: ticket.pnr ?? "",
            route: ticket.route ?? "",
            issue_date: ticket.issue_date ?? "",
            travel_date: ticket.travel_date ?? "",
            return_date: ticket.return_date ?? "",
            client_id: ticket.client_id ?? "",
            supplier_id: ticket.supplier_id ?? "",
            purchase_price: ticket.purchase_price ?? "",
            gds_price: ticket.gds_price ?? "",
            sell_price: ticket.sell_price ?? "",
            status: ticket.status ?? "booked",
            narration: ticket.narration ?? "",
          }
        : { ...EMPTY, issue_date: new Date().toISOString().split("T")[0] }
    )
    fetchDropdowns()
  }, [isOpen, ticket])

  const fetchDropdowns = async () => {
    const [{ data: c }, { data: s }, { data: ch }] = await Promise.all([
      supabase.from("clients").select("id, name, client_id_number").eq("agent_id", agent.id).order("client_id_number", { ascending: true }),
      supabase.from("suppliers").select("id, name, supplier_id_number").eq("agent_id", agent.id).order("supplier_id_number", { ascending: true }),
      fetchChannels(agent.id),
    ])
    setClients(c ?? [])
    setSuppliers(s ?? [])
    setChannels(ch ?? [])
  }

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  const setC = (field) => (e) => setClientPay((p) => ({ ...p, [field]: e.target.value }))
  const setS = (field) => (e) => setSupplierPay((p) => ({ ...p, [field]: e.target.value }))

  useEffect(() => {
    if (clientPayOpen && form.issue_date && !clientPay.payment_date) {
      setClientPay((p) => ({ ...p, payment_date: form.issue_date }))
    }
  }, [clientPayOpen, form.issue_date])

  const handleClientPaidInFull = (e) => {
    setClientPay((p) => ({ ...p, paid_in_full: e.target.checked, amount: e.target.checked ? "" : p.amount }))
  }

  const handleSupplierPaidInFull = (e) => {
    setSupplierPay((p) => ({ ...p, paid_in_full: e.target.checked, amount: e.target.checked ? "" : p.amount }))
  }

  const handleAddNewClient = async (name) => {
    const data = await createClient(supabase, agent.id, name)
    setClients((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setForm((f) => ({ ...f, client_id: data.id }))
  }

  const handleSameAsPassenger = async () => {
    const name = form.passenger_name.trim()
    if (!name) return
    const existing = clients.find((c) => c.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      setForm((f) => ({ ...f, client_id: existing.id }))
      return
    }
    const data = await createClient(supabase, agent.id, name)
    setClients((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setForm((f) => ({ ...f, client_id: data.id }))
  }

  const handleAddNewSupplier = async (name) => {
    const data = await createSupplier(supabase, agent.id, name)
    setSuppliers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setForm((f) => ({ ...f, supplier_id: data.id }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    const purchasePrice = parseFloat(form.purchase_price)
    const gdsPrice = form.gds_price !== "" ? parseFloat(form.gds_price) : null

    const payload = {
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
      sell_price: parseFloat(form.sell_price),
      status: form.status,
      narration: form.narration.trim() || null,
    }

    const isEdit = !!ticket?.id
    let result
    if (isEdit) {
      // A manual edit is always the deliberate, self-explanatory case — clear
      // any auto-override marker (e.g. from voiding) since the agent just set
      // this price on purpose.
      result = await supabase
        .from("tickets")
        .update({ ...payload, price_override_source: null })
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

    if (result.error) {
      setError(result.error.message)
      setLoading(false)
      return
    }

    const savedTicket = result.data
    const today = new Date().toISOString().split("T")[0]

    if (isEdit) {
      if (ticket.sell_price !== payload.sell_price || ticket.purchase_price !== payload.purchase_price) {
        logActivity({
          agentId: agent.id,
          ticketId: savedTicket.id,
          eventType: "ticket_price_edited",
          description:
            `Price edited — sell_price ${fmt(ticket.sell_price)} → ${fmt(payload.sell_price)}, ` +
            `purchase_price ${fmt(ticket.purchase_price)} → ${fmt(payload.purchase_price)}`,
          metadata: {
            before: { sell_price: ticket.sell_price, purchase_price: ticket.purchase_price },
            after: { sell_price: payload.sell_price, purchase_price: payload.purchase_price },
          },
        })
      }
    } else {
      logActivity({
        agentId: agent.id,
        ticketId: savedTicket.id,
        eventType: "ticket_created",
        description: `Ticket created — sell_price ${fmt(payload.sell_price)}, purchase_price ${fmt(payload.purchase_price)}`,
        metadata: { sell_price: payload.sell_price, purchase_price: payload.purchase_price },
      })
    }

    // Client payment — independent transaction
    const clientAmount = clientPay.paid_in_full ? parseFloat(form.sell_price) : parseFloat(clientPay.amount)
    if (clientAmount > 0) {
      const selectedClientChannel = channels.find((c) => c.id === clientPay.channel_id)
      const { data: payRow, error: payErr } = await supabase
        .from("payments")
        .insert({
          agent_id: agent.id,
          client_id: savedTicket.client_id,
          type: "client_payment",
          amount: clientAmount,
          unallocated_amount: 0,
          channel: selectedClientChannel?.name ?? null,
          channel_id: clientPay.channel_id || null,
          trx_id: clientPay.trx_id.trim() || null,
          notes: clientPay.notes.trim() || null,
          payment_date: clientPay.payment_date || form.issue_date || today,
        })
        .select("id")
        .single()

      if (!payErr && payRow) {
        await supabase.from("ticket_payments").insert({
          payment_id: payRow.id,
          ticket_id: savedTicket.id,
          allocated_amount: clientAmount,
          type: "client",
        })

        const newAmountPaid = (savedTicket.amount_paid ?? 0) + clientAmount
        const newPaymentStatus = derivePaymentStatus(newAmountPaid, clientEffectiveTarget(savedTicket))
        await supabase
          .from("tickets")
          .update({ amount_paid: newAmountPaid, payment_status: newPaymentStatus })
          .eq("id", savedTicket.id)
        savedTicket.amount_paid = newAmountPaid
        savedTicket.payment_status = newPaymentStatus

        logActivity({
          agentId: agent.id,
          ticketId: savedTicket.id,
          paymentId: payRow.id,
          eventType: "payment_created",
          description: `Client payment recorded at ticket save — ${fmt(clientAmount)}`,
          metadata: { amount: clientAmount },
        })
      }
    }

    // Supplier payment — independent transaction
    const supplierAmount = supplierPay.paid_in_full ? parseFloat(form.purchase_price) : parseFloat(supplierPay.amount)
    if (supplierAmount > 0) {
      const selectedSupplierChannel = channels.find((c) => c.id === supplierPay.channel_id)
      const { data: payRow, error: payErr } = await supabase
        .from("payments")
        .insert({
          agent_id: agent.id,
          supplier_id: savedTicket.supplier_id,
          type: "supplier_payment",
          amount: supplierAmount,
          unallocated_amount: 0,
          channel: selectedSupplierChannel?.name ?? null,
          channel_id: supplierPay.channel_id || null,
          trx_id: supplierPay.trx_id.trim() || null,
          notes: supplierPay.notes.trim() || null,
          payment_date: today,
        })
        .select("id")
        .single()

      if (!payErr && payRow) {
        await supabase.from("ticket_payments").insert({
          payment_id: payRow.id,
          ticket_id: savedTicket.id,
          allocated_amount: supplierAmount,
          type: "supplier",
        })

        logActivity({
          agentId: agent.id,
          ticketId: savedTicket.id,
          paymentId: payRow.id,
          eventType: "payment_created",
          description: `Supplier payment recorded at ticket save — ${fmt(supplierAmount)}`,
          metadata: { amount: supplierAmount },
        })
      }
    }

    setLoading(false)
    onSaved(savedTicket)
    onClose()
  }

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 px-4 py-6"
      onMouseDown={handleBackdrop}
    >
      <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {ticket?.id ? "Edit ticket" : cloneMode ? "Clone ticket" : "Add ticket"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
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
            <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form id="ticket-form" onSubmit={handleSubmit} className="space-y-5">
            {/* Passenger */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Passenger</legend>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Passenger Name <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.passenger_name}
                    onChange={set("passenger_name")}
                    placeholder="Full name"
                    className={inputCls}
                  />
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
                  <input
                    type="text"
                    value={form.ticket_number}
                    onChange={set("ticket_number")}
                    placeholder="e.g. 996-1234567890"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    PNR <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.pnr}
                    onChange={set("pnr")}
                    placeholder="e.g. ABC123"
                    className={inputCls}
                  />
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
                  <input
                    type="text"
                    required
                    value={form.route}
                    onChange={set("route")}
                    placeholder="e.g. DAC-DXB"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Issue Date <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={form.issue_date}
                    onChange={set("issue_date")}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Travel Date <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={form.travel_date}
                    onChange={set("travel_date")}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Return Date</label>
                  <input
                    type="date"
                    value={form.return_date}
                    onChange={set("return_date")}
                    className={inputCls}
                  />
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
                    entityType="client"
                    idField="client_id_number"
                    extraOption={{
                      label: "Same as passenger",
                      onSelect: handleSameAsPassenger,
                    }}
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
                    entityType="supplier"
                    idField="supplier_id_number"
                  />
                </div>
              </div>
            </fieldset>

            {/* Financials */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Financials</legend>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {/* Left: purchase price + supplier purchase price sub-field */}
                <div className="space-y-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Purchase Price <span className="text-red-500 dark:text-red-400">*</span>
                    </label>
                    <input
                      type="number" onKeyDown={blockNonNumericKeys}
                      required
                      min="0"
                      step="0.01"
                      value={form.purchase_price}
                      onChange={set("purchase_price")}
                      placeholder="0.00"
                      className={inputCls}
                    />
                  </div>
                  <div className="pl-3 border-l-2 border-gray-100 dark:border-gray-800">
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Supplier Purchase Price</label>
                    <input
                      type="number" onKeyDown={blockNonNumericKeys}
                      min="0"
                      step="0.01"
                      value={form.gds_price}
                      onChange={set("gds_price")}
                      placeholder="0.00"
                      className={inputCls}
                    />
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Informational only — no effect on calculations</p>
                  </div>
                </div>

                {/* Right: sell price */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Sell Price <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="number" onKeyDown={blockNonNumericKeys}
                    required
                    min="0"
                    step="0.01"
                    value={form.sell_price}
                    onChange={set("sell_price")}
                    placeholder="0.00"
                    className={inputCls}
                  />
                </div>
              </div>
            </fieldset>

            {/* Notes */}
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Notes</legend>
              <textarea
                value={form.narration}
                onChange={set("narration")}
                placeholder="Any notes about this ticket…"
                rows={3}
                className={`${inputCls} resize-none`}
              />
            </fieldset>

            {/* Client + Supplier Payment — create mode only */}
            {!ticket?.id && <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setClientPayOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors"
              >
                <span>Client Payment</span>
                <svg
                  className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform ${clientPayOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {clientPayOpen && (
                <div className="px-4 py-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Payment Date <span className="text-red-500 dark:text-red-400">*</span>
                      </label>
                      <input
                        type="date"
                        required
                        value={clientPay.payment_date || form.issue_date}
                        onChange={setC("payment_date")}
                        className={inputCls}
                      />
                    </div>
                    <div />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount Received</label>
                      <input
                        type="number" onKeyDown={blockNonNumericKeys}
                        min="0"
                        step="0.01"
                        value={clientPay.paid_in_full ? (form.sell_price || "") : clientPay.amount}
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
                    <input
                      type="text"
                      value={clientPay.trx_id}
                      onChange={setC("trx_id")}
                      placeholder="Reference or TrxID"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
                    <input
                      type="text"
                      value={clientPay.notes}
                      onChange={setC("notes")}
                      placeholder="Optional note"
                      className={inputCls}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={clientPay.paid_in_full}
                      onChange={handleClientPaidInFull}
                      className="rounded border-gray-300 dark:border-gray-700 text-blue-600 dark:text-blue-400 focus:ring-blue-500"
                    />
                    Paid in full (fills sell price)
                  </label>
                </div>
              )}
            </div>}

            {!ticket?.id && <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setSupplierPayOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors"
              >
                <span>Supplier Payment</span>
                <svg
                  className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform ${supplierPayOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {supplierPayOpen && (
                <div className="px-4 py-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount Paid</label>
                      <input
                        type="number" onKeyDown={blockNonNumericKeys}
                        min="0"
                        step="0.01"
                        value={supplierPay.paid_in_full ? (form.purchase_price || "") : supplierPay.amount}
                        onChange={setS("amount")}
                        disabled={supplierPay.paid_in_full}
                        placeholder="0.00"
                        className={`${inputCls} ${supplierPay.paid_in_full ? "bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400" : ""}`}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Channel</label>
                      <select value={supplierPay.channel_id} onChange={setS("channel_id")} className={inputCls}>
                        <option value="">— Select —</option>
                        {channels.map((ch) => (
                          <option key={ch.id} value={ch.id}>{ch.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Transaction ID</label>
                    <input
                      type="text"
                      value={supplierPay.trx_id}
                      onChange={setS("trx_id")}
                      placeholder="Reference or TrxID"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
                    <input
                      type="text"
                      value={supplierPay.notes}
                      onChange={setS("notes")}
                      placeholder="Optional note"
                      className={inputCls}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={supplierPay.paid_in_full}
                      onChange={handleSupplierPaidInFull}
                      className="rounded border-gray-300 dark:border-gray-700 text-blue-600 dark:text-blue-400 focus:ring-blue-500"
                    />
                    Paid in full (fills purchase price)
                  </label>
                </div>
              )}
            </div>}
          </form>
        </div>

        {/* Footer */}
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
            form="ticket-form"
            disabled={loading}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Saving…" : ticket?.id ? "Save changes" : cloneMode ? "Save cloned ticket" : "Add ticket"}
          </button>
        </div>
      </div>
    </div>
  )
}
