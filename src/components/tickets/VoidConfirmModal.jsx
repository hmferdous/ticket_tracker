import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { fetchChannels } from "../../lib/channels"

export default function VoidConfirmModal({ isOpen, onClose, ticket, onSaved }) {
  const { agent } = useAuth()
  const [channels, setChannels] = useState([])
  const [supplierFee, setSupplierFee] = useState("")
  const [supplierFeeChannelId, setSupplierFeeChannelId] = useState("")
  const [clientFee, setClientFee] = useState("")
  const [clientFeeChannelId, setClientFeeChannelId] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (isOpen) {
      setSupplierFee("")
      setSupplierFeeChannelId("")
      setClientFee("")
      setClientFeeChannelId("")
      setError("")
      if (agent?.id) fetchChannels(agent.id).then(({ data }) => setChannels(data ?? []))
    }
  }, [isOpen, agent?.id])

  if (!isOpen) return null

  const handleConfirm = async () => {
    setError("")

    const supplierFeeAmount = supplierFee !== "" ? parseFloat(supplierFee) : 0
    const clientFeeAmount = clientFee !== "" ? parseFloat(clientFee) : 0

    if (supplierFeeAmount > 0 && !ticket.supplier_id) {
      setError("This ticket has no supplier linked — can't record a supplier fee")
      return
    }
    if (clientFeeAmount > 0 && !ticket.client_id) {
      setError("This ticket has no client linked — can't record a client fee")
      return
    }

    setLoading(true)

    const today = new Date().toISOString().split("T")[0]
    const supplierChannel = channels.find((c) => c.id === supplierFeeChannelId)
    const clientChannel = channels.find((c) => c.id === clientFeeChannelId)

    if (supplierFeeAmount > 0) {
      const { data: payRow, error: payErr } = await supabase
        .from("payments")
        .insert({
          agent_id: agent.id,
          supplier_id: ticket.supplier_id,
          type: "supplier_payment",
          amount: supplierFeeAmount,
          unallocated_amount: 0,
          channel: supplierChannel?.name ?? null,
          channel_id: supplierFeeChannelId || null,
          payment_date: today,
        })
        .select("id")
        .single()

      if (payErr) { setLoading(false); setError(payErr.message); return }

      const { error: tpErr } = await supabase.from("ticket_payments").insert({
        payment_id: payRow.id,
        ticket_id: ticket.id,
        allocated_amount: supplierFeeAmount,
        type: "void_fee_supplier",
      })
      if (tpErr) { setLoading(false); setError(tpErr.message); return }
    }

    if (clientFeeAmount > 0) {
      const { data: payRow, error: payErr } = await supabase
        .from("payments")
        .insert({
          agent_id: agent.id,
          client_id: ticket.client_id,
          type: "client_payment",
          amount: clientFeeAmount,
          unallocated_amount: 0,
          channel: clientChannel?.name ?? null,
          channel_id: clientFeeChannelId || null,
          payment_date: today,
        })
        .select("id")
        .single()

      if (payErr) { setLoading(false); setError(payErr.message); return }

      const { error: tpErr } = await supabase.from("ticket_payments").insert({
        payment_id: payRow.id,
        ticket_id: ticket.id,
        allocated_amount: clientFeeAmount,
        type: "void_fee_client",
      })
      if (tpErr) { setLoading(false); setError(tpErr.message); return }
    }

    const { data, error } = await supabase
      .from("tickets")
      .update({
        is_void: true,
        status: "void",
        void_fee_paid: supplierFeeAmount > 0 ? supplierFeeAmount : null,
        void_fee_collected: clientFeeAmount > 0 ? clientFeeAmount : null,
      })
      .eq("id", ticket.id)
      .select(`*, clients(name), suppliers(name)`)
      .single()

    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    onSaved(data)
    onClose()
  }

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 px-4 py-6"
      onMouseDown={handleBackdrop}
    >
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-xl flex flex-col">
        <div className="px-6 py-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Void this ticket?</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Mark this ticket as void? This cannot be undone.
          </p>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
            Cancellation fees (optional)
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fee charged by supplier</label>
                <input type="number" min="0" step="0.01" value={supplierFee} onChange={(e) => setSupplierFee(e.target.value)} placeholder="0.00" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Channel</label>
                <select value={supplierFeeChannelId} onChange={(e) => setSupplierFeeChannelId(e.target.value)} className={inputCls}>
                  <option value="">— Select —</option>
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fee charged to client</label>
                <input type="number" min="0" step="0.01" value={clientFee} onChange={(e) => setClientFee(e.target.value)} placeholder="0.00" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Channel</label>
                <select value={clientFeeChannelId} onChange={(e) => setClientFeeChannelId(e.target.value)} className={inputCls}>
                  <option value="">— Select —</option>
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
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
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Voiding…" : "Mark as void"}
          </button>
        </div>
      </div>
    </div>
  )
}
