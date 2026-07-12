import { useCallback, useEffect, useMemo, useState } from "react"
import { Wallet, Send, Undo2, PackageCheck } from "lucide-react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import SearchableEntityDropdown from "../ui/SearchableEntityDropdown"
import { createClient, createSupplier } from "../tickets/TicketModal"

const CHANNELS = ["Cash", "bKash", "Bank", "Office", "EBL", "DBBL", "IBBL", "City", "BRAC", "UCB"]

const TYPE_CARDS = [
  { value: "client_payment", label: "Client Payment", direction: "IN", icon: Wallet },
  { value: "supplier_payment", label: "Supplier Payment", direction: "OUT", icon: Send },
  { value: "client_refund", label: "Client Refund", direction: "OUT", icon: Undo2 },
  { value: "supplier_refund", label: "Supplier Refund", direction: "IN", icon: PackageCheck },
]

const TYPE_LABELS = {
  client_payment: "Client Payment",
  supplier_payment: "Supplier Payment",
  client_refund: "Client Refund",
  supplier_refund: "Supplier Refund",
}

function emptyForm() {
  return {
    client_id: "",
    supplier_id: "",
    amount: "",
    channel: "",
    trx_id: "",
    payment_date: new Date().toISOString().split("T")[0],
    notes: "",
    ticket_id: "",
  }
}

function derivePaymentStatus(amountPaid, sellPrice) {
  if (amountPaid <= 0) return "unpaid"
  if (amountPaid >= sellPrice) return "paid"
  return "partial"
}

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

export default function LogTransactionModal({ isOpen, onClose, onLogged }) {
  const { agent } = useAuth()

  const [step, setStep] = useState(1)
  const [type, setType] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [clients, setClients] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // All hooks must be above the early return
  const ticketOptions = useMemo(
    () => tickets.map((t) => ({ id: t.id, name: `${t.passenger_name} — ${t.route ?? "—"}` })),
    [tickets]
  )

  const fetchDropdowns = useCallback(async () => {
    if (!agent?.id) return
    const [{ data: c }, { data: s }] = await Promise.all([
      supabase.from("clients").select("id, name, client_id_number").eq("agent_id", agent.id).order("name"),
      supabase.from("suppliers").select("id, name, supplier_id_number").eq("agent_id", agent.id).order("name"),
    ])
    setClients(c ?? [])
    setSuppliers(s ?? [])
  }, [agent?.id])

  const fetchTicketsForClient = useCallback(async (clientId) => {
    const { data } = await supabase
      .from("tickets")
      .select("id, passenger_name, route, amount_paid, sell_price")
      .eq("agent_id", agent.id)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
    setTickets(data ?? [])
  }, [agent?.id])

  const fetchTicketsForSupplier = useCallback(async (supplierId) => {
    const { data } = await supabase
      .from("tickets")
      .select("id, passenger_name, route, refund_received, refund_paid, refund_payable, refund_receivable, refund_status")
      .eq("agent_id", agent.id)
      .eq("supplier_id", supplierId)
      .order("created_at", { ascending: false })
    setTickets(data ?? [])
  }, [agent?.id])

  useEffect(() => {
    if (isOpen) {
      setStep(1)
      setType(null)
      setForm(emptyForm())
      setTickets([])
      setError("")
      fetchDropdowns()
    }
  }, [isOpen, fetchDropdowns])

  useEffect(() => {
    if (type === "client_refund" && form.client_id) {
      fetchTicketsForClient(form.client_id)
    } else if (type === "supplier_refund" && form.supplier_id) {
      fetchTicketsForSupplier(form.supplier_id)
    } else {
      setTickets([])
    }
  }, [type, form.client_id, form.supplier_id, fetchTicketsForClient, fetchTicketsForSupplier])

  // Early return after all hooks
  if (!isOpen) return null

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleSelectType = (value) => {
    setType(value)
    setForm(emptyForm())
    setError("")
    setStep(2)
  }

  const handleBack = () => {
    setStep(1)
    setType(null)
    setForm(emptyForm())
    setTickets([])
    setError("")
  }

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleAddNewClient = async (name) => {
    const data = await createClient(supabase, agent.id, name)
    setClients((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setForm((f) => ({ ...f, client_id: data.id, ticket_id: "" }))
  }

  const handleAddNewSupplier = async (name) => {
    const data = await createSupplier(supabase, agent.id, name)
    setSuppliers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setForm((f) => ({ ...f, supplier_id: data.id, ticket_id: "" }))
  }

  const ticketClearOption = {
    label: "— No ticket —",
    onSelect: () => setForm((f) => ({ ...f, ticket_id: "" })),
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")

    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) {
      setError("Enter a valid amount")
      return
    }

    if (type === "client_payment") {
      if (!form.client_id) { setError("Select a client"); return }

      setLoading(true)

      const { data: clientPayment, error: payErr } = await supabase
        .from("payments")
        .insert({
          agent_id: agent.id,
          client_id: form.client_id,
          type: "client_payment",
          amount,
          unallocated_amount: amount,
          channel: form.channel || null,
          trx_id: form.trx_id.trim() || null,
          notes: form.notes.trim() || null,
          payment_date: form.payment_date,
        })
        .select("*, clients(name)")
        .single()

      if (payErr) { setError(payErr.message); setLoading(false); return }

      setLoading(false)
      onLogged(clientPayment)
      onClose()
      return
    }

    if (type === "supplier_payment") {
      if (!form.supplier_id) { setError("Select a supplier"); return }

      setLoading(true)

      const { data: payment, error: payErr } = await supabase
        .from("payments")
        .insert({
          agent_id: agent.id,
          supplier_id: form.supplier_id,
          type: "supplier_payment",
          amount,
          unallocated_amount: amount,
          channel: form.channel || null,
          trx_id: form.trx_id.trim() || null,
          notes: form.notes.trim() || null,
          payment_date: form.payment_date,
        })
        .select("*, suppliers(name)")
        .single()

      if (payErr) { setError(payErr.message); setLoading(false); return }

      setLoading(false)
      onLogged(payment)
      onClose()
      return
    }

    if (type === "client_refund") {
      if (!form.client_id) { setError("Select a client"); return }

      setLoading(true)

      const { data: refund, error: payErr } = await supabase
        .from("payments")
        .insert({
          agent_id: agent.id,
          client_id: form.client_id,
          type: "client_refund",
          amount,
          unallocated_amount: 0,
          channel: form.channel || null,
          trx_id: form.trx_id.trim() || null,
          notes: form.notes.trim() || null,
          payment_date: form.payment_date,
        })
        .select()
        .single()

      if (payErr) { setError(payErr.message); setLoading(false); return }

      if (form.ticket_id) {
        const ticket = tickets.find((t) => t.id === form.ticket_id)

        const { error: tpErr } = await supabase.from("ticket_payments").insert({
          payment_id: refund.id,
          ticket_id: form.ticket_id,
          allocated_amount: -amount,
          type: "client_refund",
        })
        if (tpErr) { setError(tpErr.message); setLoading(false); return }

        if (ticket) {
          const newAmountPaid = (ticket.amount_paid ?? 0) - amount
          const newStatus = derivePaymentStatus(newAmountPaid, ticket.sell_price ?? 0)
          await supabase
            .from("tickets")
            .update({ amount_paid: newAmountPaid, payment_status: newStatus })
            .eq("id", form.ticket_id)
        }
      }

      setLoading(false)
      onLogged(refund)
      onClose()
      return
    }

    if (type === "supplier_refund") {
      if (!form.supplier_id) { setError("Select a supplier"); return }

      setLoading(true)

      const { data: refund, error: payErr } = await supabase
        .from("payments")
        .insert({
          agent_id: agent.id,
          supplier_id: form.supplier_id,
          ticket_id: form.ticket_id || null,
          type: "supplier_refund",
          amount,
          unallocated_amount: 0,
          channel: form.channel || null,
          trx_id: form.trx_id.trim() || null,
          notes: form.notes.trim() || null,
          payment_date: form.payment_date,
        })
        .select()
        .single()

      if (payErr) { setError(payErr.message); setLoading(false); return }

      if (form.ticket_id) {
        const ticket = tickets.find((t) => t.id === form.ticket_id)
        const refundStatus = ticket?.refund_paid != null ? "closed" : "supplier_refunded"

        const { error: tErr } = await supabase
          .from("tickets")
          .update({ refund_received: amount, refund_status: refundStatus })
          .eq("id", form.ticket_id)
        if (tErr) { setError(tErr.message); setLoading(false); return }
      }

      setLoading(false)
      onLogged(refund)
      onClose()
      return
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6" onMouseDown={handleBackdrop}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            {step === 1 ? "Log Transaction" : TYPE_LABELS[type]}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
          )}

          {step === 1 && (
            <div className="grid sm:grid-cols-2 gap-3">
              {TYPE_CARDS.map(({ value, label, direction, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleSelectType(value)}
                  className="flex items-center gap-4 text-left border border-gray-200 rounded-xl p-5 hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
                >
                  <div className="flex-shrink-0 w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-gray-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900">{label}</p>
                  </div>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      direction === "IN" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    }`}
                  >
                    {direction}
                  </span>
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <form id="log-transaction-form" onSubmit={handleSubmit} className="space-y-3">
              {type === "client_payment" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Client <span className="text-red-500">*</span>
                  </label>
                  <SearchableEntityDropdown
                    entities={clients}
                    value={form.client_id}
                    onChange={(id) => setForm((f) => ({ ...f, client_id: id }))}
                    placeholder="Search client…"
                    onAddNew={handleAddNewClient}
                    entityType="client"
                    idField="client_id_number"
                  />
                </div>
              )}

              {type === "supplier_payment" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Supplier <span className="text-red-500">*</span>
                  </label>
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
              )}

              {type === "client_refund" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Client <span className="text-red-500">*</span>
                  </label>
                  <SearchableEntityDropdown
                    entities={clients}
                    value={form.client_id}
                    onChange={(id) => setForm((f) => ({ ...f, client_id: id, ticket_id: "" }))}
                    placeholder="Search client…"
                    onAddNew={handleAddNewClient}
                    entityType="client"
                    idField="client_id_number"
                  />
                </div>
              )}

              {type === "supplier_refund" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Supplier <span className="text-red-500">*</span>
                  </label>
                  <SearchableEntityDropdown
                    entities={suppliers}
                    value={form.supplier_id}
                    onChange={(id) => setForm((f) => ({ ...f, supplier_id: id, ticket_id: "" }))}
                    placeholder="Search supplier…"
                    onAddNew={handleAddNewSupplier}
                    entityType="supplier"
                    idField="supplier_id_number"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Amount <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={set("amount")}
                    placeholder="0.00"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
                  <input type="date" value={form.payment_date} onChange={set("payment_date")} className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Channel</label>
                  <select value={form.channel} onChange={set("channel")} className={inputCls}>
                    <option value="">— Select —</option>
                    {CHANNELS.map((ch) => (
                      <option key={ch} value={ch}>{ch}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Transaction ID</label>
                  <input
                    type="text"
                    value={form.trx_id}
                    onChange={set("trx_id")}
                    placeholder="Reference or TrxID"
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={set("notes")}
                  placeholder="Optional note"
                  className={inputCls}
                />
              </div>


              {type === "client_refund" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Link to Ticket (optional)</label>
                  <SearchableEntityDropdown
                    entities={ticketOptions}
                    value={form.ticket_id}
                    onChange={(id) => setForm((f) => ({ ...f, ticket_id: id }))}
                    placeholder={form.client_id ? "Search tickets…" : "Select a client first"}
                    extraOption={ticketClearOption}
                  />
                </div>
              )}

              {type === "supplier_refund" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Link to Ticket (optional)</label>
                  <SearchableEntityDropdown
                    entities={ticketOptions}
                    value={form.ticket_id}
                    onChange={(id) => setForm((f) => ({ ...f, ticket_id: id }))}
                    placeholder={form.supplier_id ? "Search tickets…" : "Select a supplier first"}
                    extraOption={ticketClearOption}
                  />
                </div>
              )}
            </form>
          )}
        </div>

        {step === 2 && (
          <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
            <button
              type="button"
              onClick={handleBack}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Back
            </button>
            <button
              type="submit"
              form="log-transaction-form"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? "Saving…" : "Log transaction"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
