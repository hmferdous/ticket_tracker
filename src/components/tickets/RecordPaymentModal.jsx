import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { fetchChannels } from "../../lib/channels"
import { deriveRefundStatus, clientOutstanding, clientEffectiveTarget } from "../../lib/refunds"
import { blockNonNumericKeys } from "../../lib/numberInput"
import { logActivity } from "../../lib/activityLog"

const EMPTY = { amount: "", channel_id: "", trx_id: "", notes: "", paid_in_full: false, payment_date: "" }

function fmt(n) {
  return Number(n ?? 0).toLocaleString("en-BD")
}

function derivePaymentStatus(amountPaid, sellPrice) {
  if (amountPaid <= 0) return "unpaid"
  if (amountPaid >= sellPrice) return "paid"
  return "partial"
}

export default function RecordPaymentModal({ isOpen, onClose, ticket, onSaved }) {
  const { agent } = useAuth()
  const [form, setForm] = useState(EMPTY)
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (isOpen) {
      setForm({ ...EMPTY, payment_date: new Date().toISOString().split("T")[0] })
      setError("")
      if (agent?.id) fetchChannels(agent.id).then(({ data }) => setChannels(data ?? []))
    }
  }, [isOpen, ticket, agent?.id])

  if (!isOpen) return null

  const outstanding = clientOutstanding(ticket)
  const hasActiveRefund = ticket.refund_status != null && ticket.refund_status !== "closed"

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const handlePaidInFull = (e) => {
    if (e.target.checked) {
      setForm((f) => ({ ...f, paid_in_full: true, amount: String(outstanding) }))
    } else {
      setForm((f) => ({ ...f, paid_in_full: false, amount: "" }))
    }
  }

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")
    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) {
      setError("Enter a valid amount")
      return
    }
    setLoading(true)

    const selectedChannel = channels.find((c) => c.id === form.channel_id)

    // Cap what actually applies to this ticket at its outstanding — any
    // excess spills into unallocated credit on the payment, same as a bulk
    // payment logged via Log Transaction, instead of silently overpaying
    // this one ticket with no trace of where the extra went.
    const allocatedAmount = Math.min(amount, outstanding)
    const excess = amount - allocatedAmount

    const { data: payRow, error: payErr } = await supabase
      .from("payments")
      .insert({
        agent_id: agent.id,
        client_id: ticket.client_id,
        type: "client_payment",
        amount,
        unallocated_amount: excess,
        channel: selectedChannel?.name ?? null,
        channel_id: form.channel_id || null,
        trx_id: form.trx_id.trim() || null,
        notes: form.notes.trim() || null,
        payment_date: form.payment_date || new Date().toISOString().split("T")[0],
      })
      .select("id, amount, unallocated_amount")
      .single()

    if (payErr) {
      setError(payErr.message)
      setLoading(false)
      return
    }

    if (allocatedAmount > 0) {
      const { error: tpErr } = await supabase.from("ticket_payments").insert({
        payment_id: payRow.id,
        ticket_id: ticket.id,
        allocated_amount: allocatedAmount,
        type: "client",
      })

      if (tpErr) {
        setError(tpErr.message)
        setLoading(false)
        return
      }
    }

    const newAmountPaid = (ticket.amount_paid ?? 0) + allocatedAmount
    const newPaymentStatus = derivePaymentStatus(newAmountPaid, clientEffectiveTarget(ticket))
    const updates = { amount_paid: newAmountPaid, payment_status: newPaymentStatus }

    // A payment collected while a refund is active is how a credit-booking
    // ticket settles down to its reduced target — recompute refund_status so
    // it can advance to client_refunded/closed without ever touching refund_paid.
    if (hasActiveRefund) {
      updates.refund_status = deriveRefundStatus({
        receivable: ticket.refund_receivable,
        received: ticket.refund_received,
        sellPrice: ticket.sell_price,
        amountPaid: newAmountPaid,
        payable: ticket.refund_payable,
      })
    }

    const { data: updated, error: updateErr } = await supabase
      .from("tickets")
      .update(updates)
      .eq("id", ticket.id)
      .select(`*, clients(name), suppliers(name)`)
      .single()

    setLoading(false)
    if (updateErr) {
      setError(updateErr.message)
      return
    }

    logActivity({
      agentId: agent.id,
      ticketId: ticket.id,
      paymentId: payRow.id,
      eventType: "payment_created",
      description: `Client payment recorded — ${fmt(amount)}${excess > 0 ? ` (${fmt(allocatedAmount)} applied, ${fmt(excess)} left unallocated)` : ""}`,
      metadata: { amount, allocated_amount: allocatedAmount, unallocated_amount: excess },
    })

    onSaved(updated, payRow)
    onClose()
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 px-4 py-6"
      onMouseDown={handleBackdrop}
    >
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Record payment</h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Outstanding amount: <span className="font-medium text-gray-700 dark:text-gray-300">{outstanding.toLocaleString("en-BD")}</span>
            {hasActiveRefund && <span className="text-xs text-orange-600 dark:text-orange-400"> (reduced by an active refund)</span>}
          </p>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form id="record-payment-form" onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Payment Date <span className="text-red-500 dark:text-red-400">*</span>
              </label>
              <input
                type="date"
                required
                value={form.payment_date}
                onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Amount <span className="text-red-500 dark:text-red-400">*</span>
              </label>
              <input
                type="number" onKeyDown={blockNonNumericKeys}
                required
                min="0"
                step="0.01"
                value={form.amount}
                onChange={set("amount")}
                placeholder="0.00"
                className={inputCls}
              />
              {parseFloat(form.amount) > outstanding && (
                <p className="mt-1 text-xs text-orange-600 dark:text-orange-400">
                  → {(parseFloat(form.amount) - outstanding).toLocaleString("en-BD")} more than outstanding — the extra will be left as unallocated credit, and you'll be prompted to distribute it
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Channel</label>
              <select value={form.channel_id} onChange={set("channel_id")} className={inputCls}>
                <option value="">— Select —</option>
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>{ch.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Transaction ID</label>
              <input
                type="text"
                value={form.trx_id}
                onChange={set("trx_id")}
                placeholder="Reference or TrxID"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
              <input
                type="text"
                value={form.notes}
                onChange={set("notes")}
                placeholder="Optional note"
                className={inputCls}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.paid_in_full}
                onChange={handlePaidInFull}
                className="rounded border-gray-300 dark:border-gray-700 text-blue-600 dark:text-blue-400 focus:ring-blue-500"
              />
              Paid in full (fills outstanding amount)
            </label>
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
            form="record-payment-form"
            disabled={loading}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Saving…" : "Record payment"}
          </button>
        </div>
      </div>
    </div>
  )
}
