import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import AppLayout from "../../components/layout/AppLayout"
import AllocationModal from "../../components/clients/AllocationModal"
import SupplierAllocationModal from "../../components/suppliers/SupplierAllocationModal"
import ViewPaymentModal from "../../components/payments/ViewPaymentModal"
import LogTransactionModal from "../../components/payments/LogTransactionModal"
import { fetchChannels } from "../../lib/channels"
import { reverseTicketPaymentRow, reverseStandaloneSupplierRefund, TICKET_REVERSAL_FIELDS } from "../../lib/paymentReversal"
import { logActivity } from "../../lib/activityLog"

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200]

const TYPE_OPTIONS = [
  { value: "", label: "All Types" },
  { value: "client_payment", label: "Client Payments" },
  { value: "supplier_payment", label: "Supplier Payments" },
  { value: "client_refund", label: "Client Refunds" },
  { value: "supplier_refund", label: "Supplier Refunds" },
]

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
      return { label: "Client Payment", cls: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" }
    case "supplier_payment":
      return { label: "Supplier Payment", cls: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" }
    case "client_refund":
      return { label: "Client Refund", cls: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400" }
    case "supplier_refund":
      return { label: "Supplier Refund", cls: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400" }
    default:
      return { label: type ?? "—", cls: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400" }
  }
}

function PartyCell({ payment }) {
  const isClientSide = payment.type === "client_payment" || payment.type === "client_refund"
  const party = isClientSide ? payment.clients : payment.suppliers
  if (!party) return <span className="text-gray-300 dark:text-gray-600">—</span>
  const label = isClientSide ? clientIdLabel(party.client_id_number) : supplierIdLabel(party.supplier_id_number)
  const cls = isClientSide ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" : "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400"
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold tracking-wide ${cls}`}>{label}</span>
      <span className="text-gray-700 dark:text-gray-300">{party.name}</span>
    </div>
  )
}

function TicketTagCell({ payment }) {
  const tps = payment.ticket_payments ?? []
  if (tps.length === 0) return <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
  if (tps.length === 1) {
    const t = tps[0].tickets
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded w-fit">{t?.pnr?.toUpperCase() ?? "—"}</span>
        <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate max-w-[120px]">{t?.passenger_name ?? ""}</span>
      </div>
    )
  }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 cursor-default"
      title={tps.map((tp) => tp.tickets?.pnr?.toUpperCase() ?? "—").join(", ")}
    >
      {tps.length} tickets
    </span>
  )
}

function StatChip({ label, value, accent }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-full text-sm">
      <span className="text-gray-400 dark:text-gray-500 text-xs font-medium uppercase tracking-wide">{label}</span>
      <span className={`font-semibold tabular-nums ${accent ?? "text-gray-900 dark:text-gray-100"}`}>{fmt(value)}</span>
    </div>
  )
}

export default function Payments() {
  const { agent } = useAuth()

  const [payments, setPayments] = useState([])
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [searchText, setSearchText] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [channelFilter, setChannelFilter] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const [viewingPayment, setViewingPayment] = useState(null)
  const [allocationTarget, setAllocationTarget] = useState(null) // { kind: 'client'|'supplier', payment, tickets, name }
  const [allocatingId, setAllocatingId] = useState(null)
  const [showLogTransaction, setShowLogTransaction] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    if (agent?.id) {
      fetchPayments()
      fetchChannels(agent.id, { includeArchived: true }).then(({ data }) => setChannels(data ?? []))
    }
  }, [agent])

  // Reset to page 1 whenever any filter changes
  useEffect(() => {
    setPage(1)
  }, [searchText, typeFilter, channelFilter, dateFrom, dateTo])

  const fetchPayments = async () => {
    setLoading(true)
    setError("")
    const { data, error } = await supabase
      .from("payments")
      .select(`
        id, client_id, supplier_id, ticket_id, type, amount, unallocated_amount, channel, channel_id, trx_id, notes, payment_date, created_at,
        clients(name, client_id_number),
        suppliers(name, supplier_id_number),
        ticket_payments(type, tickets(pnr, passenger_name))
      `)
      .eq("agent_id", agent.id)
      .order("payment_date", { ascending: false })

    setLoading(false)
    if (error) setError(error.message)
    else setPayments(data ?? [])
  }

  const clearFilters = () => {
    setSearchText("")
    setTypeFilter("")
    setChannelFilter("")
    setDateFrom("")
    setDateTo("")
  }

  const filteredPayments = useMemo(() => {
    const search = searchText.trim().toLowerCase()
    return payments.filter((p) => {
      if (search) {
        const haystack = `${p.trx_id ?? ""} ${p.notes ?? ""} ${p.clients?.name ?? ""} ${p.suppliers?.name ?? ""}`.toLowerCase()
        if (!haystack.includes(search)) return false
      }
      if (typeFilter && p.type !== typeFilter) return false
      if (channelFilter && p.channel_id !== channelFilter) return false
      if (dateFrom && (!p.payment_date || p.payment_date < dateFrom)) return false
      if (dateTo && (!p.payment_date || p.payment_date > dateTo)) return false
      return true
    })
  }, [payments, searchText, typeFilter, channelFilter, dateFrom, dateTo])

  const totalIn = useMemo(
    () => filteredPayments.filter((p) => p.type === "client_payment").reduce((sum, p) => sum + (p.amount ?? 0), 0),
    [filteredPayments]
  )
  const totalOut = useMemo(
    () => filteredPayments.filter((p) => p.type === "supplier_payment").reduce((sum, p) => sum + (p.amount ?? 0), 0),
    [filteredPayments]
  )
  const net = totalIn - totalOut

  const totalPages = Math.max(1, Math.ceil(filteredPayments.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const startIdx = (safePage - 1) * pageSize
  const pagedPayments = filteredPayments.slice(startIdx, startIdx + pageSize)
  const showingFrom = filteredPayments.length === 0 ? 0 : startIdx + 1
  const showingTo = Math.min(startIdx + pageSize, filteredPayments.length)

  const openAllocate = async (payment) => {
    setAllocatingId(payment.id)
    if (payment.client_id) {
      const { data } = await supabase
        .from("tickets")
        .select(
          "id, passenger_name, route, travel_date, issue_date, sell_price, amount_paid, payment_status, created_at, " +
            "refund_status, refund_receivable, refund_received, refund_payable, refund_paid"
        )
        .eq("client_id", payment.client_id)
        .eq("agent_id", agent.id)
        .is("archived_at", null)
      setAllocationTarget({ kind: "client", payment, tickets: data ?? [], name: payment.clients?.name })
    } else if (payment.supplier_id) {
      const { data } = await supabase
        .from("tickets")
        .select(
          "id, passenger_name, route, travel_date, issue_date, purchase_price, sell_price, amount_paid, ticket_payments(allocated_amount, type), created_at, " +
            "refund_status, refund_receivable, refund_received, refund_payable, refund_paid"
        )
        .eq("supplier_id", payment.supplier_id)
        .eq("agent_id", agent.id)
        .is("archived_at", null)
      const withSupplierPaid = (data ?? []).map((t) => ({
        ...t,
        supplierAmountPaid: (t.ticket_payments ?? [])
          .filter((tp) => tp.type === "supplier")
          .reduce((sum, tp) => sum + (tp.allocated_amount ?? 0), 0),
      }))
      setAllocationTarget({ kind: "supplier", payment, tickets: withSupplierPaid, name: payment.suppliers?.name })
    }
    setAllocatingId(null)
  }

  const handleAllocationClose = () => {
    setAllocationTarget(null)
    fetchPayments()
  }

  const handleDeletePayment = async (payment) => {
    const { data: tps } = await supabase
      .from("ticket_payments")
      .select("id, ticket_id, allocated_amount, type")
      .eq("payment_id", payment.id)

    const isStandaloneSupplierRefund = payment.type === "supplier_refund" && payment.ticket_id && (tps ?? []).length === 0

    const ticketIds = new Set((tps ?? []).map((tp) => tp.ticket_id))
    if (isStandaloneSupplierRefund) ticketIds.add(payment.ticket_id)

    let ticketsById = new Map()
    if (ticketIds.size > 0) {
      const { data: tickets } = await supabase
        .from("tickets")
        .select(TICKET_REVERSAL_FIELDS)
        .in("id", Array.from(ticketIds))
      ticketsById = new Map((tickets ?? []).map((t) => [t.id, t]))
    }

    const reversals = (tps ?? [])
      .map((tp) => ({ tp, ticket: ticketsById.get(tp.ticket_id) }))
      .filter((r) => r.ticket)
      .map((r) => ({ ...r, ...reverseTicketPaymentRow(r.ticket, r.tp) }))

    let standaloneReversal = null
    if (isStandaloneSupplierRefund) {
      const ticket = ticketsById.get(payment.ticket_id)
      if (ticket) standaloneReversal = reverseStandaloneSupplierRefund(ticket, payment)
    }

    const anyClamped = reversals.some((r) => r.clamped) || standaloneReversal?.clamped
    const warning = anyClamped
      ? "\n\nWarning: one or more linked tickets already had their running total edited lower than what this payment contributed — the reversal will floor at 0 instead of going negative, which may not fully undo this payment's effect."
      : ""
    if (!window.confirm(`Delete this payment? This cannot be undone.${warning}`)) return

    setDeletingId(payment.id)

    for (const r of reversals) {
      if (Object.keys(r.updates).length > 0) {
        await supabase.from("tickets").update(r.updates).eq("id", r.tp.ticket_id)
      }
    }
    if (standaloneReversal) {
      await supabase.from("tickets").update(standaloneReversal.updates).eq("id", payment.ticket_id)
    }

    if ((tps ?? []).length > 0) {
      await supabase.from("ticket_payments").delete().eq("payment_id", payment.id)
    }

    const { error } = await supabase.from("payments").delete().eq("id", payment.id)
    setDeletingId(null)
    if (error) { setError(error.message); return }

    logActivity({
      agentId: agent.id,
      ticketId: ticketIds.size > 0 ? Array.from(ticketIds)[0] : null,
      eventType: "payment_deleted",
      description: `Payment deleted — ${fmt(payment.amount)} (${payment.type})`,
      metadata: { payment_id: payment.id, amount: payment.amount, type: payment.type, reversed_tickets: Array.from(ticketIds) },
    })

    fetchPayments()
  }

  const handleTransactionLogged = (payment) => {
    if (payment.type === "client_payment" || payment.type === "supplier_payment") {
      openAllocate(payment)
    } else {
      fetchPayments()
    }
  }

  return (
    <AppLayout
      title="Payments"
      actions={
        <button
          onClick={() => setShowLogTransaction(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + Log Transaction
        </button>
      }
    >
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Filter bar */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Search</label>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Trx ID, notes, client or supplier…"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="w-48">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Type</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="w-40">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Channel</label>
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Channels</option>
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>{ch.name}{!ch.is_active ? " (archived)" : ""}</option>
                ))}
              </select>
            </div>
            <div className="w-36">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="w-36">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={clearFilters}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Clear filters
            </button>
          </div>
        </div>

        {/* Summary chips */}
        <div className="flex flex-wrap gap-3 mb-4">
          <StatChip label="Total In" value={totalIn} accent="text-green-600 dark:text-green-400" />
          <StatChip label="Total Out" value={totalOut} accent="text-red-600 dark:text-red-400" />
          <StatChip label="Net" value={net} accent={net >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"} />
        </div>

        {/* Payments table */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="py-20 text-center text-sm text-gray-400 dark:text-gray-500">Loading payments…</div>
          ) : payments.length === 0 ? (
            <div className="py-20 text-center text-sm text-gray-400 dark:text-gray-500">No payments logged yet.</div>
          ) : filteredPayments.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-gray-400 dark:text-gray-500 text-sm">No payments match the current filters.</p>
              <button onClick={clearFilters} className="mt-3 text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium">
                Clear filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 text-left">
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Date</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Type</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Party</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Ticket</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 text-right">Amount</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Channel</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Trx ID</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 text-right">Unallocated</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Notes</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {pagedPayments.map((payment) => {
                    const badge = typeBadge(payment.type)
                    const unallocated = payment.unallocated_amount ?? 0
                    return (
                      <tr key={payment.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{fmtDate(payment.payment_date)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3"><PartyCell payment={payment} /></td>
                        <td className="px-4 py-3"><TicketTagCell payment={payment} /></td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{fmt(payment.amount)}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{payment.channel ?? "—"}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{payment.trx_id ?? "—"}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${unallocated > 0 ? "text-yellow-600 dark:text-yellow-400 font-medium" : "text-gray-600 dark:text-gray-400"}`}>
                          {fmt(unallocated)}
                        </td>
                        <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs max-w-[160px] truncate">
                          {payment.notes ?? <span className="text-gray-200 dark:text-gray-700">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-3">
                            {unallocated > 0 && (
                              <button
                                onClick={() => openAllocate(payment)}
                                disabled={allocatingId === payment.id}
                                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-400 font-medium transition-colors disabled:opacity-50"
                              >
                                {allocatingId === payment.id ? "…" : "Allocate"}
                              </button>
                            )}
                            <button
                              onClick={() => setViewingPayment(payment)}
                              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 font-medium transition-colors"
                            >
                              View
                            </button>
                            <button
                              onClick={() => handleDeletePayment(payment)}
                              disabled={deletingId === payment.id}
                              className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-400 font-medium transition-colors disabled:opacity-50"
                            >
                              {deletingId === payment.id ? "…" : "Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && filteredPayments.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Showing {showingFrom}-{showingTo} of {filteredPayments.length} payment
              {filteredPayments.length !== 1 ? "s" : ""}
            </p>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                Rows per page
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-800 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-gray-900 transition-colors"
                >
                  Previous
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Page {safePage} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-800 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-gray-900 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ViewPaymentModal
        isOpen={!!viewingPayment}
        onClose={() => setViewingPayment(null)}
        payment={viewingPayment}
        onSaved={fetchPayments}
      />

      <LogTransactionModal
        isOpen={showLogTransaction}
        onClose={() => setShowLogTransaction(false)}
        onLogged={handleTransactionLogged}
      />

      <AllocationModal
        isOpen={allocationTarget?.kind === "client"}
        onClose={handleAllocationClose}
        payment={allocationTarget?.payment}
        clientName={allocationTarget?.name}
        tickets={allocationTarget?.tickets ?? []}
        onAllocated={fetchPayments}
      />

      <SupplierAllocationModal
        isOpen={allocationTarget?.kind === "supplier"}
        onClose={handleAllocationClose}
        payment={allocationTarget?.payment}
        supplierName={allocationTarget?.name}
        tickets={allocationTarget?.tickets ?? []}
        onAllocated={fetchPayments}
      />
    </AppLayout>
  )
}
