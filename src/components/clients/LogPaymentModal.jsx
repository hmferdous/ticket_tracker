import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { fetchChannels } from "../../lib/channels"

function emptyForm() {
  return {
    amount: "",
    channel_id: "",
    trx_id: "",
    payment_date: new Date().toISOString().split("T")[0],
    notes: "",
  }
}

export default function LogPaymentModal({ isOpen, onClose, client, onLogged }) {
  const { agent } = useAuth()
  const [form, setForm] = useState(emptyForm)
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (isOpen) {
      setForm(emptyForm())
      setError("")
      if (agent?.id) fetchChannels(agent.id).then(({ data }) => setChannels(data ?? []))
    }
  }, [isOpen, client, agent?.id])

  if (!isOpen) return null

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

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

    setLoading(true)

    const selectedChannel = channels.find((c) => c.id === form.channel_id)

    const { data: clientPayment, error: payErr } = await supabase
      .from("payments")
      .insert({
        agent_id: agent.id,
        client_id: client.id,
        type: "client_payment",
        amount,
        unallocated_amount: amount,
        channel: selectedChannel?.name ?? null,
        channel_id: form.channel_id || null,
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
                <select value={form.channel_id} onChange={set("channel_id")} className={inputCls}>
                  <option value="">— Select —</option>
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
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
