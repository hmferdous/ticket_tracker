import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { fetchChannels } from "../../lib/channels"
import { deriveRefundStatus } from "../../lib/refunds"

const MODE_CONFIG = {
  initiate: { title: "Initiate refund", confirmLabel: "Start refund" },
  edit: { title: "Edit refund terms", confirmLabel: "Save changes" },
  supplier: { title: "Record supplier refund", confirmLabel: "Record receipt" },
  client: { title: "Record client refund", confirmLabel: "Record payment" },
  edit_supplier_actual: { title: "Edit Supplier Refund Received", confirmLabel: "Save changes" },
  edit_client_actual: { title: "Edit Client Refund Paid", confirmLabel: "Save changes" },
}

function derivePaymentStatus(amountPaid, sellPrice) {
  if (amountPaid <= 0) return "unpaid"
  if (amountPaid >= sellPrice) return "paid"
  return "partial"
}

export default function RefundModal({ isOpen, onClose, ticket, mode, onSaved }) {
  const { agent } = useAuth()
  const [receivable, setReceivable] = useState("")
  const [payable, setPayable] = useState("")
  const [notes, setNotes] = useState("")
  const [amount, setAmount] = useState("")
  const [channelId, setChannelId] = useState("")
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (isOpen) {
      setReceivable(mode === "edit" && ticket?.refund_receivable != null ? String(ticket.refund_receivable) : "")
      setPayable(mode === "edit" && ticket?.refund_payable != null ? String(ticket.refund_payable) : "")
      setNotes(mode === "edit" ? ticket?.refund_notes ?? "" : "")
      setAmount(
        mode === "edit_supplier_actual" && ticket?.refund_received != null ? String(ticket.refund_received) :
        mode === "edit_client_actual" && ticket?.refund_paid != null ? String(ticket.refund_paid) :
        ""
      )
      setChannelId("")
      setError("")
      if (agent?.id) fetchChannels(agent.id).then(({ data }) => setChannels(data ?? []))
    }
  }, [isOpen, ticket, mode, agent?.id])

  if (!isOpen) return null

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")

    if (mode === "initiate") {
      const refundReceivable = receivable !== "" ? parseFloat(receivable) : null
      const refundPayable = payable !== "" ? parseFloat(payable) : null
      setLoading(true)
      const { data, error } = await supabase
        .from("tickets")
        .update({
          refund_status: "initiated",
          refund_receivable: refundReceivable,
          refund_payable: refundPayable,
          refund_notes: notes.trim() || null,
        })
        .eq("id", ticket.id)
        .select(`*, clients(name), suppliers(name)`)
        .single()
      setLoading(false)
      if (error) { setError(error.message); return }
      onSaved(data)
      onClose()
      return
    }

    if (mode === "edit") {
      const newReceivable = receivable !== "" ? parseFloat(receivable) : null
      const newPayable = payable !== "" ? parseFloat(payable) : null
      setLoading(true)
      const { data, error } = await supabase
        .from("tickets")
        .update({
          refund_receivable: newReceivable,
          refund_payable: newPayable,
          refund_notes: notes.trim() || null,
          refund_status: deriveRefundStatus(newReceivable, newPayable, ticket.refund_received, ticket.refund_paid),
        })
        .eq("id", ticket.id)
        .select(`*, clients(name), suppliers(name)`)
        .single()
      setLoading(false)
      if (error) { setError(error.message); return }
      onSaved(data)
      onClose()
      return
    }

    if (mode === "supplier") {
      const value = parseFloat(amount)
      if (isNaN(value) || value <= 0) { setError("Enter a valid amount"); return }
      if (!ticket.supplier_id) { setError("This ticket has no supplier linked"); return }

      setLoading(true)
      const selectedChannel = channels.find((c) => c.id === channelId)
      const today = new Date().toISOString().split("T")[0]

      const { error: payErr } = await supabase.from("payments").insert({
        agent_id: agent.id,
        supplier_id: ticket.supplier_id,
        ticket_id: ticket.id,
        type: "supplier_refund",
        amount: value,
        unallocated_amount: 0,
        channel: selectedChannel?.name ?? null,
        channel_id: channelId || null,
        payment_date: today,
      })
      if (payErr) { setLoading(false); setError(payErr.message); return }

      const newReceived = (ticket.refund_received ?? 0) + value
      const newStatus = deriveRefundStatus(ticket.refund_receivable, ticket.refund_payable, newReceived, ticket.refund_paid)

      const { data, error } = await supabase
        .from("tickets")
        .update({ refund_received: newReceived, refund_status: newStatus })
        .eq("id", ticket.id)
        .select(`*, clients(name), suppliers(name)`)
        .single()

      setLoading(false)
      if (error) { setError(error.message); return }
      onSaved(data)
      onClose()
      return
    }

    if (mode === "client") {
      const value = parseFloat(amount)
      if (isNaN(value) || value <= 0) { setError("Enter a valid amount"); return }
      if (!ticket.client_id) { setError("This ticket has no client linked"); return }

      setLoading(true)
      const selectedChannel = channels.find((c) => c.id === channelId)
      const today = new Date().toISOString().split("T")[0]

      const { data: payRow, error: payErr } = await supabase
        .from("payments")
        .insert({
          agent_id: agent.id,
          client_id: ticket.client_id,
          type: "client_refund",
          amount: value,
          unallocated_amount: 0,
          channel: selectedChannel?.name ?? null,
          channel_id: channelId || null,
          payment_date: today,
        })
        .select("id")
        .single()
      if (payErr) { setLoading(false); setError(payErr.message); return }

      const { error: tpErr } = await supabase.from("ticket_payments").insert({
        payment_id: payRow.id,
        ticket_id: ticket.id,
        allocated_amount: -value,
        type: "client_refund",
      })
      if (tpErr) { setLoading(false); setError(tpErr.message); return }

      const newPaid = (ticket.refund_paid ?? 0) + value
      const newAmountPaid = Math.max(0, (ticket.amount_paid ?? 0) - value)
      const newPaymentStatus = derivePaymentStatus(newAmountPaid, ticket.sell_price ?? 0)
      const newRefundStatus = deriveRefundStatus(ticket.refund_receivable, ticket.refund_payable, ticket.refund_received, newPaid)

      const { data, error } = await supabase
        .from("tickets")
        .update({
          refund_paid: newPaid,
          amount_paid: newAmountPaid,
          payment_status: newPaymentStatus,
          refund_status: newRefundStatus,
        })
        .eq("id", ticket.id)
        .select(`*, clients(name), suppliers(name)`)
        .single()

      setLoading(false)
      if (error) { setError(error.message); return }
      onSaved(data)
      onClose()
      return
    }

    if (mode === "edit_supplier_actual") {
      const value = parseFloat(amount)
      if (isNaN(value)) { setError("Enter a valid amount"); return }
      setLoading(true)
      const { data, error } = await supabase
        .from("tickets")
        .update({
          refund_received: value,
          refund_status: deriveRefundStatus(ticket.refund_receivable, ticket.refund_payable, value, ticket.refund_paid),
        })
        .eq("id", ticket.id)
        .select(`*, clients(name), suppliers(name)`)
        .single()
      setLoading(false)
      if (error) { setError(error.message); return }
      onSaved(data)
      onClose()
      return
    }

    if (mode === "edit_client_actual") {
      const value = parseFloat(amount)
      if (isNaN(value)) { setError("Enter a valid amount"); return }
      setLoading(true)
      const { data, error } = await supabase
        .from("tickets")
        .update({
          refund_paid: value,
          refund_status: deriveRefundStatus(ticket.refund_receivable, ticket.refund_payable, ticket.refund_received, value),
        })
        .eq("id", ticket.id)
        .select(`*, clients(name), suppliers(name)`)
        .single()
      setLoading(false)
      if (error) { setError(error.message); return }
      onSaved(data)
      onClose()
      return
    }
  }

  const config = MODE_CONFIG[mode] ?? MODE_CONFIG.initiate

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      onMouseDown={handleBackdrop}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{config.title}</h2>
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

          <form id="refund-form" onSubmit={handleSubmit} className="space-y-3">
            {(mode === "initiate" || mode === "edit") && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expected from Supplier</label>
                  <input
                    type="number"
                    step="0.01"
                    value={receivable}
                    onChange={(e) => setReceivable(e.target.value)}
                    placeholder="0.00"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Agreed to pay Client</label>
                  <input
                    type="number"
                    step="0.01"
                    value={payable}
                    onChange={(e) => setPayable(e.target.value)}
                    placeholder="0.00"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional note"
                    className={inputCls}
                  />
                </div>
              </>
            )}

            {mode === "supplier" && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount received from supplier</label>
                  <input
                    type="number"
                    required
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className={inputCls}
                  />
                  {ticket.refund_receivable != null && (
                    <p className="mt-1 text-xs text-gray-400">
                      Expected: {Number(ticket.refund_receivable).toLocaleString("en-BD")}
                      {(ticket.refund_received ?? 0) > 0 && ` · Received so far: ${Number(ticket.refund_received).toLocaleString("en-BD")}`}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
                  <select value={channelId} onChange={(e) => setChannelId(e.target.value)} className={inputCls}>
                    <option value="">— Select —</option>
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>{ch.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {mode === "client" && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount paid to client</label>
                  <input
                    type="number"
                    required
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className={inputCls}
                  />
                  {ticket.refund_payable != null && (
                    <p className="mt-1 text-xs text-gray-400">
                      Agreed: {Number(ticket.refund_payable).toLocaleString("en-BD")}
                      {(ticket.refund_paid ?? 0) > 0 && ` · Paid so far: ${Number(ticket.refund_paid).toLocaleString("en-BD")}`}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
                  <select value={channelId} onChange={(e) => setChannelId(e.target.value)} className={inputCls}>
                    <option value="">— Select —</option>
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>{ch.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {mode === "edit_supplier_actual" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Total received from supplier</label>
                <input
                  type="number"
                  required
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-gray-400">
                  Overrides the running total directly — doesn't change any individual refund receipt already logged.
                </p>
              </div>
            )}

            {mode === "edit_client_actual" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Total paid to client</label>
                <input
                  type="number"
                  required
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-gray-400">
                  Overrides the running total directly — doesn't change any individual refund payment already logged.
                </p>
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
            form="refund-form"
            disabled={loading}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Saving…" : config.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
