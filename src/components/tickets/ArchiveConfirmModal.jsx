import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { reverseTicketPaymentRow, TICKET_REVERSAL_FIELDS } from "../../lib/paymentReversal"

function fmt(n) {
  return Number(n ?? 0).toLocaleString("en-BD")
}

function fmtDate(d) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

// Walks the reissue chain below `ticketId` breadth-first, one level of
// parent_ticket_id at a time, since a reissue can itself be reissued again.
async function fetchDescendants(ticketId) {
  const descendants = []
  let frontier = [ticketId]
  while (frontier.length) {
    const { data } = await supabase
      .from("tickets")
      .select("id, route, travel_date, passenger_name, sell_price, pnr, ticket_number")
      .in("parent_ticket_id", frontier)
    if (!data || data.length === 0) break
    descendants.push(...data)
    frontier = data.map((d) => d.id)
  }
  return descendants
}

// Frees any ordinary client/supplier payment allocations tied to the tickets
// being archived, so the money goes back into the pool for reallocation
// instead of staying stuck on a ticket the agent can no longer see or pick.
// Void-fee and refund-netted allocations are deliberately left untouched —
// void fees are one-off payments created fully-consumed (unallocated_amount
// 0 from the start), never part of a shared pool to begin with; refund
// netting has its own refund_status knock-on effects that deserve separate
// handling, not bundling into an archive action.
async function freePaymentAllocations(ticketIds, ticketLabels) {
  const { data: tps } = await supabase
    .from("ticket_payments")
    .select("id, payment_id, ticket_id, allocated_amount, type")
    .in("ticket_id", ticketIds)
    .in("type", ["client", "supplier"])

  if (!tps || tps.length === 0) return

  const { data: tickets } = await supabase.from("tickets").select(TICKET_REVERSAL_FIELDS).in("id", ticketIds)
  const ticketsById = new Map((tickets ?? []).map((t) => [t.id, t]))

  // Reversals are applied per-ticket in sequence (not off one stale
  // snapshot) since a ticket can have more than one ticket_payments row
  // across different payments — applying both off the same starting
  // amount_paid would silently drop one of them.
  const tpsByTicket = new Map()
  for (const tp of tps) {
    const list = tpsByTicket.get(tp.ticket_id) ?? []
    list.push(tp)
    tpsByTicket.set(tp.ticket_id, list)
  }
  for (const [ticketId, ticketTps] of tpsByTicket) {
    let runningTicket = ticketsById.get(ticketId)
    if (!runningTicket) continue
    let finalUpdates = {}
    for (const tp of ticketTps) {
      const { updates } = reverseTicketPaymentRow(runningTicket, tp)
      runningTicket = { ...runningTicket, ...updates }
      finalUpdates = { ...finalUpdates, ...updates }
    }
    if (Object.keys(finalUpdates).length > 0) {
      await supabase.from("tickets").update(finalUpdates).eq("id", ticketId)
    }
  }

  await supabase.from("ticket_payments").delete().in("id", tps.map((tp) => tp.id))

  const freedByPayment = new Map()
  for (const tp of tps) {
    const label = ticketLabels.get(tp.ticket_id) ?? "an archived ticket"
    const entry = freedByPayment.get(tp.payment_id) ?? { total: 0, labels: new Set() }
    entry.total += tp.allocated_amount
    entry.labels.add(label)
    freedByPayment.set(tp.payment_id, entry)
  }

  const today = fmtDate(new Date().toISOString())
  for (const [paymentId, entry] of freedByPayment) {
    const { data: payment } = await supabase.from("payments").select("unallocated_amount, notes").eq("id", paymentId).single()
    if (!payment) continue
    const noteLine = `Freed ${fmt(entry.total)} on ${today} — previously allocated to ${Array.from(entry.labels).join(", ")}, now archived.`
    const newNotes = payment.notes ? `${payment.notes}\n${noteLine}` : noteLine
    await supabase
      .from("payments")
      .update({ unallocated_amount: (payment.unallocated_amount ?? 0) + entry.total, notes: newNotes })
      .eq("id", paymentId)
  }
}

export default function ArchiveConfirmModal({ isOpen, onClose, ticket, onArchived }) {
  const [descendants, setDescendants] = useState([])
  const [loadingChain, setLoadingChain] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (isOpen && ticket) {
      setError("")
      setDescendants([])
      setLoadingChain(true)
      fetchDescendants(ticket.id).then((d) => {
        setDescendants(d)
        setLoadingChain(false)
      })
    }
  }, [isOpen, ticket])

  if (!isOpen || !ticket) return null

  const handleConfirm = async () => {
    setArchiving(true)
    setError("")
    const allIds = [ticket.id, ...descendants.map((d) => d.id)]
    const ticketLabels = new Map(
      [ticket, ...descendants].map((t) => [t.id, t.pnr || t.ticket_number || t.passenger_name || `ticket ${t.id}`])
    )

    try {
      await freePaymentAllocations(allIds, ticketLabels)
    } catch (e) {
      setArchiving(false)
      setError(e.message ?? "Failed to free existing payment allocations")
      return
    }

    const { error } = await supabase
      .from("tickets")
      .update({ archived_at: new Date().toISOString() })
      .in("id", allIds)
    setArchiving(false)
    if (error) {
      setError(error.message)
      return
    }
    onArchived(allIds)
    onClose()
  }

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 px-4 py-6"
      onMouseDown={handleBackdrop}
    >
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-xl flex flex-col">
        <div className="px-6 py-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Delete this ticket?
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            This archives the ticket — it's removed from your lists and reports, but the record is kept
            for audit. Any client/supplier payment allocated to it is freed back up for reallocation to
            another ticket, not deleted. There's no restore option yet, so treat this as final for now.
          </p>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-100 dark:divide-gray-800 max-h-48 overflow-y-auto">
            <div className="px-3 py-2 flex items-center justify-between text-sm">
              <div className="min-w-0">
                <span className="font-medium text-gray-900 dark:text-gray-100">{ticket.passenger_name}</span>
                <span className="text-gray-400 dark:text-gray-500 ml-2 font-mono text-xs">{ticket.route || "—"}</span>
              </div>
              <span className="text-gray-500 dark:text-gray-400 tabular-nums text-xs flex-shrink-0 ml-2">{fmt(ticket.sell_price)}</span>
            </div>
            {loadingChain ? (
              <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">Checking for linked reissues…</div>
            ) : (
              descendants.map((d) => (
                <div key={d.id} className="px-3 py-2 flex items-center justify-between text-sm bg-orange-50/50 dark:bg-orange-900/10">
                  <div className="min-w-0">
                    <span className="text-orange-600 dark:text-orange-400 text-xs font-medium mr-2">Reissue</span>
                    <span className="text-gray-700 dark:text-gray-300">{d.route || "—"}</span>
                    <span className="text-gray-400 dark:text-gray-500 ml-2 text-xs">{fmtDate(d.travel_date)}</span>
                  </div>
                  <span className="text-gray-500 dark:text-gray-400 tabular-nums text-xs flex-shrink-0 ml-2">{fmt(d.sell_price)}</span>
                </div>
              ))
            )}
          </div>
          {!loadingChain && descendants.length > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              {descendants.length} linked reissue{descendants.length > 1 ? "s" : ""} will be archived together with this ticket.
            </p>
          )}
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
            disabled={archiving || loadingChain}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {archiving ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  )
}
