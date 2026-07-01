import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"

const CHANNELS = ["Cash", "bKash", "Bank", "Office", "EBL", "DBBL", "IBBL", "City", "BRAC", "UCB"]

const EMPTY = { amount: "", channel: "", trx_id: "", notes: "", paid_in_full: false }

function derivePaymentStatus(amountPaid, sellPrice) {
  if (amountPaid <= 0) return "unpaid"
  if (amountPaid >= sellPrice) return "paid"
  return "partial"
}

export default function RecordPaymentModal({ isOpen, onClose, ticket, onSaved }) {
  const { agent } = useAuth()
  const [form, setForm] = useState(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (isOpen) {
      setForm(EMPTY)
      setError("")
    }
  }, [isOpen, ticket])

  if (!isOpen) return null

  const outstanding = (ticket.sell_price ?? 0) - (ticket.amount_paid ?? 0)

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

    const today = new Date().toISOString().split("T")[0]

    const { data: payRow, error: payErr } = await supabase
      .from("payments")
      .insert({
        agent_id: agent.id,
        client_id: ticket.client_id,
        type: "client_payment",
        amount,
        unallocated_amount: 0,
        channel: form.channel || null,
        trx_id: form.trx_id.trim() || null,
        notes: form.notes.trim() || null,
        payment_date: today,
      })
      .select("id")
      .single()

    if (payErr) {
      setError(payErr.message)
      setLoading(false)
      return
    }

    const { error: tpErr } = await supabase.from("ticket_payments").insert({
      payment_id: payRow.id,
      ticket_id: ticket.id,
      allocated_amount: amount,
      type: "client",
    })

    if (tpErr) {
      setError(tpErr.message)
      setLoading(false)
      return
    }

    const newAmountPaid = (ticket.amount_paid ?? 0) + amount
    const newPaymentStatus = derivePaymentStatus(newAmountPaid, ticket.sell_price ?? 0)

    const { data: updated, error: updateErr } = await supabase
      .from("tickets")
      .update({ amount_paid: newAmountPaid, payment_status: newPaymentStatus })
      .eq("id", ticket.id)
      .select(`*, clients(name), suppliers(name)`)
      .single()

    setLoading(false)
    if (updateErr) {
      setError(updateErr.message)
      return
    }
    onSaved(updated)
    onClose()
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      onMouseDown={handleBackdrop}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Record payment</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5">
          <p className="text-sm text-gray-500 mb-4">
            Outstanding amount: <span className="font-medium text-gray-700">{outstanding.toLocaleString("en-BD")}</span>
          </p>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form id="record-payment-form" onSubmit={handleSubmit} className="space-y-3">
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
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.paid_in_full}
                onChange={handlePaidInFull}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Paid in full (fills outstanding amount)
            </label>
          </form>
        </div>

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
