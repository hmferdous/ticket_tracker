import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../lib/supabase"
import { deriveRefundStatus } from "../../lib/refunds"

function fmt(n) {
  if (n == null) return "—"
  return Number(n).toLocaleString("en-BD")
}

function fmtDate(d) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function derivePaymentStatus(amountPaid, sellPrice) {
  if (amountPaid <= 0) return "unpaid"
  if (amountPaid >= sellPrice) return "paid"
  return "partial"
}

function buildAllocations(eligibleTickets, available, mode, selectedIds) {
  if (mode === "distribute") {
    const fareTickets = eligibleTickets.filter((t) => t.kind === "fare")
    const count = fareTickets.length
    if (count === 0 || available <= 0) return []
    const share = available / count
    let remaining = available
    const allocations = []
    for (const t of fareTickets) {
      if (remaining <= 0) break
      const amt = Math.min(share, t.outstanding, remaining)
      if (amt > 0) {
        allocations.push({ ticket: t, amount: amt })
        remaining -= amt
      }
    }
    return allocations
  }
  if (mode === "select") {
    let remaining = available
    const allocations = []
    for (const t of eligibleTickets) {
      if (!selectedIds.has(t.id)) continue
      if (remaining <= 0) break
      const amt = Math.min(t.outstanding, remaining)
      allocations.push({ ticket: t, amount: amt })
      remaining -= amt
    }
    return allocations
  }
  return []
}

export default function AllocationModal({ isOpen, onClose, payment, clientName, tickets, onAllocated }) {
  const [mode, setMode] = useState(null) // null | 'distribute' | 'select'
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (isOpen) {
      setMode(null)
      setSelectedIds(new Set())
      setError("")
    }
  }, [isOpen, payment])

  // Two kinds of allocation target: a normal unpaid/partial fare (pays down
  // the ticket), or a ticket with an active refund still owed to the client
  // (settles the refund instead) — e.g. netting an incoming bulk payment
  // against a refund owed on a different ticket for the same client.
  const eligibleTickets = useMemo(() => {
    const fare = tickets
      .filter((t) => t.payment_status === "unpaid" || t.payment_status === "partial")
      .map((t) => ({ ...t, kind: "fare", outstanding: (t.sell_price ?? 0) - (t.amount_paid ?? 0) }))
    const refund = tickets
      .filter((t) => t.refund_status != null && (t.refund_payable ?? 0) - (t.refund_paid ?? 0) > 0)
      .map((t) => ({ ...t, kind: "refund", outstanding: (t.refund_payable ?? 0) - (t.refund_paid ?? 0) }))
    return [...fare, ...refund].sort((a, b) => (a.issue_date || a.created_at || "").localeCompare(b.issue_date || b.created_at || ""))
  }, [tickets])

  if (!isOpen || !payment) return null

  const available = payment.unallocated_amount ?? 0
  const allocations = buildAllocations(eligibleTickets, available, mode, selectedIds)
  const allocatingTotal = allocations.reduce((sum, a) => sum + a.amount, 0)

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleConfirm = async () => {
    if (allocations.length === 0) {
      setError("Select at least one ticket to allocate to")
      return
    }
    setError("")
    setLoading(true)

    const { error: tpErr } = await supabase.from("ticket_payments").insert(
      allocations.map((a) => ({
        payment_id: payment.id,
        ticket_id: a.ticket.id,
        allocated_amount: a.ticket.kind === "refund" ? -a.amount : a.amount,
        type: a.ticket.kind === "refund" ? "client_refund" : "client",
      }))
    )
    if (tpErr) {
      setError(tpErr.message)
      setLoading(false)
      return
    }

    const { error: payErr } = await supabase
      .from("payments")
      .update({ unallocated_amount: available - allocatingTotal })
      .eq("id", payment.id)
    if (payErr) {
      setError(payErr.message)
      setLoading(false)
      return
    }

    for (const a of allocations) {
      if (a.ticket.kind === "refund") {
        const newPaid = (a.ticket.refund_paid ?? 0) + a.amount
        const newAmountPaid = Math.max(0, (a.ticket.amount_paid ?? 0) - a.amount)
        const newPaymentStatus = derivePaymentStatus(newAmountPaid, a.ticket.sell_price ?? 0)
        const newRefundStatus = deriveRefundStatus(a.ticket.refund_receivable, a.ticket.refund_payable, a.ticket.refund_received, newPaid)
        await supabase
          .from("tickets")
          .update({
            refund_paid: newPaid,
            amount_paid: newAmountPaid,
            payment_status: newPaymentStatus,
            refund_status: newRefundStatus,
          })
          .eq("id", a.ticket.id)
      } else {
        const newAmountPaid = (a.ticket.amount_paid ?? 0) + a.amount
        const newStatus = derivePaymentStatus(newAmountPaid, a.ticket.sell_price ?? 0)
        await supabase
          .from("tickets")
          .update({ amount_paid: newAmountPaid, payment_status: newStatus })
          .eq("id", a.ticket.id)
      }
    }

    setLoading(false)
    onAllocated()
    onClose()
  }

  const cardCls =
    "text-left border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:bg-blue-50/40 transition-colors"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      onMouseDown={handleBackdrop}
    >
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            Allocate {fmt(available)} BDT{clientName ? ` — ${clientName}` : ""}
          </h2>
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

          {mode === null && (
            <div className="grid sm:grid-cols-3 gap-3">
              <button type="button" onClick={() => setMode("distribute")} className={cardCls}>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Distribute Evenly</h3>
                <p className="text-xs text-gray-500">
                  Splits {fmt(available)} equally across {eligibleTickets.filter((t) => t.kind === "fare").length} unpaid/partial ticket{eligibleTickets.filter((t) => t.kind === "fare").length === 1 ? "" : "s"}
                </p>
              </button>
              <button type="button" onClick={() => setMode("select")} className={cardCls}>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Select Tickets</h3>
                <p className="text-xs text-gray-500">
                  Pick specific tickets — fills oldest first. Includes tickets with a refund still owed to this client
                </p>
              </button>
              <button type="button" onClick={onClose} className={cardCls}>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Skip for Now</h3>
                <p className="text-xs text-gray-500">
                  Leave the full amount as unallocated credit on this client's account
                </p>
              </button>
            </div>
          )}

          {mode === "distribute" && (
            <div className="space-y-3">
              {allocations.length === 0 ? (
                <p className="text-sm text-gray-400">No unpaid or partial tickets to allocate to.</p>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left text-xs text-gray-500">
                        <th className="px-3 py-2 font-medium">Passenger</th>
                        <th className="px-3 py-2 font-medium">Route</th>
                        <th className="px-3 py-2 font-medium text-right">Outstanding</th>
                        <th className="px-3 py-2 font-medium text-right">Allocating</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {allocations.map(({ ticket, amount }) => (
                        <tr key={ticket.id}>
                          <td className="px-3 py-2 text-gray-700">{ticket.passenger_name}</td>
                          <td className="px-3 py-2 text-gray-600">{ticket.route ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{fmt(ticket.outstanding)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium text-blue-700">{fmt(amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-sm text-gray-500">
                Allocating <span className="font-medium text-gray-800">{fmt(allocatingTotal)}</span> of {fmt(available)} BDT
                {allocatingTotal < available && " — remainder stays as unallocated credit"}
              </p>
            </div>
          )}

          {mode === "select" && (
            <div className="space-y-3">
              {eligibleTickets.length === 0 ? (
                <p className="text-sm text-gray-400">No unpaid/partial tickets or open refunds to allocate to.</p>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left text-xs text-gray-500">
                        <th className="px-3 py-2 font-medium w-8"></th>
                        <th className="px-3 py-2 font-medium">Passenger</th>
                        <th className="px-3 py-2 font-medium">Route</th>
                        <th className="px-3 py-2 font-medium">Travel Date</th>
                        <th className="px-3 py-2 font-medium">Purpose</th>
                        <th className="px-3 py-2 font-medium text-right">Outstanding</th>
                        <th className="px-3 py-2 font-medium text-right">Allocating</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {eligibleTickets.map((ticket) => {
                        const allocation = allocations.find((a) => a.ticket.id === ticket.id)
                        return (
                          <tr key={ticket.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(ticket.id)}
                                onChange={() => toggleSelect(ticket.id)}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-3 py-2 text-gray-700">{ticket.passenger_name}</td>
                            <td className="px-3 py-2 text-gray-600">{ticket.route ?? "—"}</td>
                            <td className="px-3 py-2 text-gray-600">{fmtDate(ticket.travel_date)}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                  ticket.kind === "refund" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"
                                }`}
                              >
                                {ticket.kind === "refund" ? "Refund owed" : "Fare"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-600">{fmt(ticket.outstanding)}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium text-blue-700">
                              {allocation ? fmt(allocation.amount) : "—"}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-sm text-gray-500">
                Allocating <span className="font-medium text-gray-800">{fmt(allocatingTotal)}</span> of {fmt(available)} BDT
                {selectedIds.size > 0 && allocatingTotal < available && " — remainder stays as unallocated credit"}
              </p>
            </div>
          )}
        </div>

        {mode !== null && (
          <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
            <button
              type="button"
              onClick={() => {
                setMode(null)
                setSelectedIds(new Set())
                setError("")
              }}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading || allocations.length === 0}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? "Allocating…" : "Confirm allocation"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
