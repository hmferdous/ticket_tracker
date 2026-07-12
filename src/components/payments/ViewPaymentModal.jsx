import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { fetchChannels } from "../../lib/channels"

function fmt(n) {
  if (n == null) return "—"
  return Number(n).toLocaleString("en-BD")
}

function fmtDate(d) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function clientIdLabel(num) {
  if (num == null) return "—"
  return `C-${String(num).padStart(3, "0")}`
}

function supplierIdLabel(num) {
  if (num == null) return "—"
  return `S-${String(num).padStart(3, "0")}`
}

function typeBadge(type) {
  switch (type) {
    case "client_payment":
      return { label: "Client Payment", cls: "bg-green-100 text-green-700" }
    case "supplier_payment":
      return { label: "Supplier Payment", cls: "bg-red-100 text-red-700" }
    case "client_refund":
      return { label: "Client Refund", cls: "bg-blue-100 text-blue-700" }
    case "supplier_refund":
      return { label: "Supplier Refund", cls: "bg-orange-100 text-orange-700" }
    default:
      return { label: type ?? "—", cls: "bg-gray-100 text-gray-600" }
  }
}

function derivePaymentStatus(amountPaid, sellPrice) {
  if (amountPaid <= 0) return "unpaid"
  if (amountPaid >= sellPrice) return "paid"
  return "partial"
}

function buildForm(payment) {
  return {
    amount: payment?.amount ?? "",
    channel_id: payment?.channel_id ?? "",
    trx_id: payment?.trx_id ?? "",
    notes: payment?.notes ?? "",
    payment_date: payment?.payment_date ?? "",
  }
}

export default function ViewPaymentModal({ isOpen, onClose, payment, onSaved }) {
  const { agent } = useAuth()
  const [allocations, setAllocations] = useState([])
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(() => buildForm(payment))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (isOpen && payment) {
      setEditing(false)
      setForm(buildForm(payment))
      fetchAllocations()
      if (agent?.id) fetchChannels(agent.id, { includeArchived: true }).then(({ data }) => setChannels(data ?? []))
    } else {
      setAllocations([])
      setError("")
    }
  }, [isOpen, payment, agent?.id])

  const fetchAllocations = async () => {
    setLoading(true)
    setError("")
    const { data, error } = await supabase
      .from("ticket_payments")
      .select("id, allocated_amount, type, tickets(id, passenger_name, route, amount_paid, sell_price)")
      .eq("payment_id", payment.id)

    setLoading(false)
    if (error) setError(error.message)
    else setAllocations(data ?? [])
  }

  if (!isOpen || !payment) return null

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const badge = typeBadge(payment.type)
  const isClientSide = payment.type === "client_payment" || payment.type === "client_refund"
  const party = isClientSide ? payment.clients : payment.suppliers
  const partyLabel = isClientSide
    ? clientIdLabel(party?.client_id_number)
    : supplierIdLabel(party?.supplier_id_number)
  const partyBadgeCls = isClientSide ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"

  const allocatedAmount = (payment.amount ?? 0) - (payment.unallocated_amount ?? 0)
  const linkedRefundAlloc = allocations.find((a) => a.type === "client_refund")
  const cascadesToTicket = payment.type === "client_refund" && !!linkedRefundAlloc

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  const handleSave = async (e) => {
    e.preventDefault()
    setError("")

    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) {
      setError("Enter a valid amount")
      return
    }

    setSaving(true)

    const selectedChannel = channels.find((c) => c.id === form.channel_id)

    const baseUpdates = {
      amount,
      channel: selectedChannel?.name ?? null,
      channel_id: form.channel_id || null,
      trx_id: form.trx_id.trim() || null,
      notes: form.notes.trim() || null,
      payment_date: form.payment_date || null,
    }

    if (payment.type === "client_payment" || payment.type === "supplier_payment") {
      const newUnallocated = amount - allocatedAmount
      if (newUnallocated < 0) {
        setSaving(false)
        setError(`Amount can't be less than the already-allocated amount (${fmt(allocatedAmount)}). Unallocate first.`)
        return
      }
      const { error } = await supabase
        .from("payments")
        .update({ ...baseUpdates, unallocated_amount: newUnallocated })
        .eq("id", payment.id)
      setSaving(false)
      if (error) { setError(error.message); return }
      onSaved?.()
      onClose()
      return
    }

    if (cascadesToTicket) {
      const oldAmount = payment.amount ?? 0
      const ticket = linkedRefundAlloc.tickets
      const newAmountPaid = (ticket?.amount_paid ?? 0) + oldAmount - amount

      if (newAmountPaid < 0) {
        setSaving(false)
        setError(`That would leave the linked ticket's paid amount negative. The most this refund can be is ${fmt((ticket?.amount_paid ?? 0) + oldAmount)}.`)
        return
      }

      const { error: tpErr } = await supabase
        .from("ticket_payments")
        .update({ allocated_amount: -amount })
        .eq("id", linkedRefundAlloc.id)
      if (tpErr) { setSaving(false); setError(tpErr.message); return }

      if (ticket) {
        const newStatus = derivePaymentStatus(newAmountPaid, ticket.sell_price ?? 0)
        const { error: tErr } = await supabase
          .from("tickets")
          .update({ amount_paid: newAmountPaid, payment_status: newStatus })
          .eq("id", ticket.id)
        if (tErr) { setSaving(false); setError(tErr.message); return }
      }
    }

    if (payment.type === "supplier_refund" && payment.ticket_id) {
      const { error: srErr } = await supabase
        .from("tickets")
        .update({ refund_received: amount })
        .eq("id", payment.ticket_id)
      if (srErr) { setSaving(false); setError(srErr.message); return }
    }

    const { error } = await supabase.from("payments").update(baseUpdates).eq("id", payment.id)
    setSaving(false)
    if (error) { setError(error.message); return }
    onSaved?.()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6" onMouseDown={handleBackdrop}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{editing ? "Edit Payment" : "Payment Details"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
          )}

          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.cls}`}>
              {badge.label}
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold tracking-wide ${partyBadgeCls}`}>
              {partyLabel}
            </span>
            <span className="text-gray-800 text-sm">{party?.name ?? "—"}</span>
          </div>

          {!editing ? (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-400 text-xs mb-1">Date</p>
                <p className="text-gray-800">{fmtDate(payment.payment_date)}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">Amount</p>
                <p className="text-gray-800 tabular-nums">{fmt(payment.amount)} BDT</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">Channel</p>
                <p className="text-gray-800">{payment.channel ?? "—"}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">Trx ID</p>
                <p className="text-gray-800">{payment.trx_id ?? "—"}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">Unallocated</p>
                <p className={`tabular-nums ${(payment.unallocated_amount ?? 0) > 0 ? "text-yellow-600 font-medium" : "text-gray-800"}`}>
                  {fmt(payment.unallocated_amount)} BDT
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-gray-400 text-xs mb-1">Notes</p>
                <p className="text-gray-800">{payment.notes || "—"}</p>
              </div>
            </div>
          ) : (
            <form id="edit-payment-form" onSubmit={handleSave} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                  <input type="number" required min="0" step="0.01" value={form.amount} onChange={set("amount")} className={inputCls} />
                  {(payment.type === "client_payment" || payment.type === "supplier_payment") && allocatedAmount > 0 && (
                    <p className="mt-1 text-xs text-gray-400">Can't go below {fmt(allocatedAmount)} (already allocated)</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
                  <input type="date" value={form.payment_date} onChange={set("payment_date")} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
                  <select value={form.channel_id} onChange={set("channel_id")} className={inputCls}>
                    <option value="">— Select —</option>
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>{ch.name}{!ch.is_active ? " (archived)" : ""}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Transaction ID</label>
                  <input type="text" value={form.trx_id} onChange={set("trx_id")} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input type="text" value={form.notes} onChange={set("notes")} className={inputCls} />
              </div>
              {payment.type === "supplier_refund" && !payment.ticket_id && (
                <p className="text-xs text-gray-400">
                  Not linked to a ticket — this edit only changes the payment record.
                </p>
              )}
              {payment.type === "supplier_refund" && payment.ticket_id && (
                <p className="text-xs text-gray-400">
                  Linked to a ticket — the amount also updates that ticket's refund received.
                </p>
              )}
              {payment.type === "client_refund" && !cascadesToTicket && (
                <p className="text-xs text-gray-400">
                  Not linked to a ticket — this edit only changes the payment record.
                </p>
              )}
            </form>
          )}

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Allocated to Tickets</h3>
            {loading ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : allocations.length === 0 ? (
              <p className="text-sm text-gray-400">No tickets allocated from this payment yet.</p>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs text-gray-500">
                      <th className="px-3 py-2 font-medium">Passenger</th>
                      <th className="px-3 py-2 font-medium">Route</th>
                      <th className="px-3 py-2 font-medium text-right">Allocated Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {allocations.map((a) => (
                      <tr key={a.id}>
                        <td className="px-3 py-2 text-gray-700">{a.tickets?.passenger_name ?? "—"}</td>
                        <td className="px-3 py-2 text-gray-600">{a.tickets?.route ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-blue-700">{fmt(a.allocated_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-100">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => { setEditing(false); setForm(buildForm(payment)); setError("") }}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="edit-payment-form"
                disabled={saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => setEditing(true)}
                className="px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Edit
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
