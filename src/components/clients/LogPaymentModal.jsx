import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import SearchableEntityDropdown from "../ui/SearchableEntityDropdown"

const CHANNELS = ["Cash", "bKash", "Bank", "Office", "EBL", "DBBL", "IBBL", "City", "BRAC", "UCB"]

function emptyForm() {
  return {
    amount: "",
    channel: "",
    trx_id: "",
    payment_date: new Date().toISOString().split("T")[0],
    notes: "",
    forward: false,
    supplier_id: "",
    fwd_amount: "",
    fwd_channel: "",
    fwd_trx_id: "",
    different_amount: false,
    fwd_custom_amount: "",
    fwd_reason: "",
  }
}

export default function LogPaymentModal({ isOpen, onClose, client, suppliers, onLogged }) {
  const { agent } = useAuth()
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (isOpen) {
      setForm(emptyForm())
      setError("")
    }
  }, [isOpen, client])

  if (!isOpen) return null

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleForwardToggle = (e) => {
    const checked = e.target.checked
    setForm((f) => ({
      ...f,
      forward: checked,
      fwd_amount: checked && !f.fwd_amount ? f.amount : f.fwd_amount,
    }))
  }

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")

    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) {
      setError("Enter a valid amount")
      return
    }

    let forwardAmount = null
    if (form.forward) {
      if (!form.supplier_id) {
        setError("Select a supplier to forward to")
        return
      }
      forwardAmount = form.different_amount
        ? parseFloat(form.fwd_custom_amount)
        : parseFloat(form.fwd_amount || form.amount)
      if (isNaN(forwardAmount) || forwardAmount < 0) {
        setError("Enter a valid supplier amount")
        return
      }
    }

    setLoading(true)

    const { data: clientPayment, error: payErr } = await supabase
      .from("payments")
      .insert({
        agent_id: agent.id,
        client_id: client.id,
        type: "client_payment",
        amount,
        unallocated_amount: amount,
        channel: form.channel || null,
        trx_id: form.trx_id.trim() || null,
        notes: form.notes.trim() || null,
        payment_date: form.payment_date,
      })
      .select()
      .single()

    if (payErr) {
      setError(payErr.message)
      setLoading(false)
      return
    }

    if (form.forward) {
      const { error: fwdErr } = await supabase.from("payments").insert({
        agent_id: agent.id,
        supplier_id: form.supplier_id,
        type: "supplier_payment",
        amount: forwardAmount,
        unallocated_amount: forwardAmount,
        channel: form.fwd_channel || null,
        trx_id: form.fwd_trx_id.trim() || null,
        notes: form.fwd_reason.trim() || null,
        payment_date: form.payment_date,
      })
      if (fwdErr) {
        setError(fwdErr.message)
        setLoading(false)
        return
      }
    }

    setLoading(false)
    onLogged(clientPayment)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      onMouseDown={handleBackdrop}
    >
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Log payment — {client?.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form id="log-payment-form" onSubmit={handleSubmit} className="space-y-3">
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
                <input
                  type="date"
                  value={form.payment_date}
                  onChange={set("payment_date")}
                  className={inputCls}
                />
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

            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                checked={form.forward}
                onChange={handleForwardToggle}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Forward to supplier
            </label>

            {form.forward && (
              <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                  <SearchableEntityDropdown
                    entities={suppliers}
                    value={form.supplier_id}
                    onChange={(id) => setForm((f) => ({ ...f, supplier_id: id }))}
                    placeholder="Search suppliers…"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.fwd_amount}
                      onChange={set("fwd_amount")}
                      disabled={form.different_amount}
                      placeholder="0.00"
                      className={`${inputCls} ${form.different_amount ? "bg-gray-100 text-gray-400" : ""}`}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Payment Channel</label>
                    <select value={form.fwd_channel} onChange={set("fwd_channel")} className={inputCls}>
                      <option value="">— Select —</option>
                      {CHANNELS.map((ch) => (
                        <option key={ch} value={ch}>{ch}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Transaction ID</label>
                  <input
                    type="text"
                    value={form.fwd_trx_id}
                    onChange={set("fwd_trx_id")}
                    placeholder="Reference or TrxID"
                    className={inputCls}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.different_amount}
                    onChange={(e) => setForm((f) => ({ ...f, different_amount: e.target.checked }))}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Different amount to supplier
                </label>
                {form.different_amount && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Amount</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.fwd_custom_amount}
                        onChange={set("fwd_custom_amount")}
                        placeholder="0.00"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                      <input
                        type="text"
                        value={form.fwd_reason}
                        onChange={set("fwd_reason")}
                        placeholder="Optional reason"
                        className={inputCls}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
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
            form="log-payment-form"
            disabled={loading}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Saving…" : "Log payment"}
          </button>
        </div>
      </div>
    </div>
  )
}
