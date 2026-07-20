import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { deriveRefundStatus } from "../../lib/refunds"
import { logActivity } from "../../lib/activityLog"

function fmt(n) {
  if (n == null) return "—"
  return Number(n).toLocaleString("en-BD")
}

function fmtDate(d) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
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

export default function SupplierAllocationModal({ isOpen, onClose, payment, supplierName, tickets, onAllocated }) {
  const { agent } = useAuth()
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

  // Two kinds of allocation target: a normal outstanding purchase price (pays
  // down the ticket), or a ticket with an active refund still owed by this
  // supplier (settles the refund instead) — e.g. netting an outgoing bulk
  // payment against a refund the supplier owes on a different ticket.
  const eligibleTickets = useMemo(() => {
    const fare = tickets
      .map((t) => ({ ...t, kind: "fare", outstanding: (t.purchase_price ?? 0) - (t.supplierAmountPaid ?? 0) }))
      .filter((t) => t.outstanding > 0)
    const refund = tickets
      .filter((t) => t.refund_status != null && (t.refund_receivable ?? 0) - (t.refund_received ?? 0) > 0)
      .map((t) => ({ ...t, kind: "refund", outstanding: (t.refund_receivable ?? 0) - (t.refund_received ?? 0) }))
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
        type: a.ticket.kind === "refund" ? "supplier_refund" : "supplier",
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
        const newReceived = (a.ticket.refund_received ?? 0) + a.amount
        const newRefundStatus = deriveRefundStatus({
          receivable: a.ticket.refund_receivable,
          received: newReceived,
          sellPrice: a.ticket.sell_price,
          amountPaid: a.ticket.amount_paid,
          payable: a.ticket.refund_payable,
        })
        await supabase
          .from("tickets")
          .update({ refund_received: newReceived, refund_status: newRefundStatus })
          .eq("id", a.ticket.id)
      }
    }

    logActivity({
      agentId: agent.id,
      paymentId: payment.id,
      eventType: "payment_allocated",
      description: `Allocated ${fmt(allocatingTotal)} of ${fmt(available)} across ${allocations.length} ticket${allocations.length > 1 ? "s" : ""}`,
      metadata: { allocations: allocations.map((a) => ({ ticket_id: a.ticket.id, amount: a.amount, kind: a.ticket.kind })) },
    })

    setLoading(false)
    onAllocated()
    onClose()
  }

  const cardCls =
    "text-left border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-blue-300 hover:bg-blue-50/40 transition-colors"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 px-4 py-6"
      onMouseDown={handleBackdrop}
    >
      <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Allocate {fmt(available)} BDT{supplierName ? ` — ${supplierName}` : ""}
          </h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          {mode === null && (
            <div className="grid sm:grid-cols-3 gap-3">
              <button type="button" onClick={() => setMode("distribute")} className={cardCls}>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Distribute Evenly</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Splits {fmt(available)} equally across {eligibleTickets.filter((t) => t.kind === "fare").length} ticket{eligibleTickets.filter((t) => t.kind === "fare").length === 1 ? "" : "s"} with outstanding supplier payment
                </p>
              </button>
              <button type="button" onClick={() => setMode("select")} className={cardCls}>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Select Tickets</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Pick specific tickets — fills oldest first. Includes tickets with a refund still owed by this supplier
                </p>
              </button>
              <button type="button" onClick={onClose} className={cardCls}>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Skip for Now</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Leave the full amount as unallocated credit on this supplier's account
                </p>
              </button>
            </div>
          )}

          {mode === "distribute" && (
            <div className="space-y-3">
              {allocations.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">No tickets with outstanding supplier payment to allocate to.</p>
              ) : (
                <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800 text-left text-xs text-gray-500 dark:text-gray-400">
                        <th className="px-3 py-2 font-medium">Passenger</th>
                        <th className="px-3 py-2 font-medium">Route</th>
                        <th className="px-3 py-2 font-medium text-right">Outstanding</th>
                        <th className="px-3 py-2 font-medium text-right">Allocating</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {allocations.map(({ ticket, amount }) => (
                        <tr key={ticket.id}>
                          <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{ticket.passenger_name}</td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{ticket.route ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{fmt(ticket.outstanding)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium text-blue-700 dark:text-blue-400">{fmt(amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Allocating <span className="font-medium text-gray-800 dark:text-gray-200">{fmt(allocatingTotal)}</span> of {fmt(available)} BDT
                {allocatingTotal < available && " — remainder stays as unallocated credit"}
              </p>
            </div>
          )}

          {mode === "select" && (
            <div className="space-y-3">
              {eligibleTickets.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">No tickets with outstanding supplier payment or open refunds to allocate to.</p>
              ) : (
                <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800 text-left text-xs text-gray-500 dark:text-gray-400">
                        <th className="px-3 py-2 font-medium w-8"></th>
                        <th className="px-3 py-2 font-medium">Passenger</th>
                        <th className="px-3 py-2 font-medium">Route</th>
                        <th className="px-3 py-2 font-medium">Travel Date</th>
                        <th className="px-3 py-2 font-medium">Purpose</th>
                        <th className="px-3 py-2 font-medium text-right">Outstanding</th>
                        <th className="px-3 py-2 font-medium text-right">Allocating</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {eligibleTickets.map((ticket) => {
                        const allocation = allocations.find((a) => a.ticket.id === ticket.id)
                        return (
                          <tr key={ticket.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(ticket.id)}
                                onChange={() => toggleSelect(ticket.id)}
                                className="rounded border-gray-300 dark:border-gray-700 text-blue-600 dark:text-blue-400 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{ticket.passenger_name}</td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{ticket.route ?? "—"}</td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{fmtDate(ticket.travel_date)}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                  ticket.kind === "refund" ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400" : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                                }`}
                              >
                                {ticket.kind === "refund" ? "Refund owed" : "Fare"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{fmt(ticket.outstanding)}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium text-blue-700 dark:text-blue-400">
                              {allocation ? fmt(allocation.amount) : "—"}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Allocating <span className="font-medium text-gray-800 dark:text-gray-200">{fmt(allocatingTotal)}</span> of {fmt(available)} BDT
                {selectedIds.size > 0 && allocatingTotal < available && " — remainder stays as unallocated credit"}
              </p>
            </div>
          )}
        </div>

        {mode !== null && (
          <div className="flex gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={() => {
                setMode(null)
                setSelectedIds(new Set())
                setError("")
              }}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
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
