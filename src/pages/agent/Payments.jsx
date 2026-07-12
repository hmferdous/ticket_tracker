import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import AppLayout from "../../components/layout/AppLayout"
import AllocationModal from "../../components/clients/AllocationModal"
import SupplierAllocationModal from "../../components/suppliers/SupplierAllocationModal"
import ViewPaymentModal from "../../components/payments/ViewPaymentModal"
import LogTransactionModal from "../../components/payments/LogTransactionModal"
import { fetchChannels } from "../../lib/channels"

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
      return { label: "Client Payment", cls: "bg-green-100 text-green-700" }
    case "supplier_payment":
      return { label: "Supplier Payment", cls: "bg-red-100 text-red-700" }
    case "client_refund":
      return { label: "Client Refund", cls: "bg-blue-100 text-blue-700" }
    case "supplier_refund":
      return { label: "Supplier Refund", cls: "bg-orange-100 text-orange-700" }
    default:
      return { label: type ?? "—", cls: "bg-gray-100 text-gray-600" }
  }
}

function PartyCell({ payment }) {
  const isClientSide = payment.type === "client_payment" || payment.type === "client_refund"
  const party = isClientSide ? payment.clients : payment.suppliers
  if (!party) return <span className="text-gray-300">—</span>
  const label = isClientSide ? clientIdLabel(party.client_id_number) : supplierIdLabel(party.supplier_id_number)
  const cls = isClientSide ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold tracking-wide ${cls}`}>{label}</span>
      <span className="text-gray-700">{party.name}</span>
    </div>
  )
}

function TicketTagCell({ payment }) {
  const tps = payment.ticket_payments ?? []
  if (tps.length === 0) return <span className="text-gray-300 text-xs">—</span>
  if (tps.length === 1) {
    const t = tps[0].tickets
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded w-fit">{t?.pnr?.toUpperCase() ?? "—"}</span>
        <span className="text-[11px] text-gray-400 truncate max-w-[120px]">{t?.passenger_name ?? ""}</span>
      </div>
    )
  }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 cursor-default"
      title={tps.map((tp) => tp.tickets?.pnr?.toUpperCase() ?? "—").join(", ")}
    >
      {tps.length} tickets
    </span>
  )
}

function StatChip({ label, value, accent }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-full text-sm">
      <span className="text-gray-400 text-xs font-medium uppercase tracking-wide">{label}</span>
      <span className={`font-semibold tabular-nums ${accent ?? "text-gray-900"}`}>{fmt(value)}</span>
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
        .select("id, passenger_name, route, travel_date, issue_date, sell_price, amount_paid, payment_status, created_at")
        .eq("client_id", payment.client_id)
        .eq("agent_id", agent.id)
      setAllocationTarget({ kind: "client", payment, tickets: data ?? [], name: payment.clients?.name })
    } else if (payment.supplier_id) {
      const { data } = await supabase
        .from("tickets")
        .select("id, passenger_name, route, travel_date, issue_date, purchase_price, ticket_payments(allocated_amount, type), created_at")
        .eq("supplier_id", payment.supplier_id)
        .eq("agent_id", agent.id)
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
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Filter bar */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Trx ID, notes, client or supplier…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="w-48">
              <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="w-40">
              <label className="block text-xs font-medium text-gray-500 mb-1">Channel</label>
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Channels</option>
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>{ch.name}{!ch.is_active ? " (archived)" : ""}</option>
                ))}
              </select>
            </div>
            <div className="w-36">
              <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="w-36">
              <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={clearFilters}
              className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Clear filters
            </button>
          </div>
        </div>

        {/* Summary chips */}
        <div className="flex flex-wrap gap-3 mb-4">
          <StatChip label="Total In" value={totalIn} accent="text-green-600" />
          <StatChip label="Total Out" value={totalOut} accent="text-red-600" />
          <StatChip label="Net" value={net} accent={net >= 0 ? "text-green-600" : "text-red-600"} />
        </div>

        {/* Payments table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="py-20 text-center text-sm text-gray-400">Loading payments…</div>
          ) : payments.length === 0 ? (
            <div className="py-20 text-center text-sm text-gray-400">No payments logged yet.</div>
          ) : filteredPayments.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-gray-400 text-sm">No payments match the current filters.</p>
              <button onClick={clearFilters} className="mt-3 text-blue-600 hover:underline text-sm font-medium">
                Clear filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left">
                    <th className="px-4 py-3 font-medium text-gray-500">Date</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Type</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Party</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Ticket</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Amount</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Channel</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Trx ID</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Unallocated</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Notes</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pagedPayments.map((payment) => {
                    const badge = typeBadge(payment.type)
                    const unallocated = payment.unallocated_amount ?? 0
                    return (
                      <tr key={payment.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-gray-600">{fmtDate(payment.payment_date)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3"><PartyCell payment={payment} /></td>
                        <td className="px-4 py-3"><TicketTagCell payment={payment} /></td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmt(payment.amount)}</td>
                        <td className="px-4 py-3 text-gray-600">{payment.channel ?? "—"}</td>
                        <td className="px-4 py-3 text-gray-600">{payment.trx_id ?? "—"}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${unallocated > 0 ? "text-yellow-600 font-medium" : "text-gray-600"}`}>
                          {fmt(unallocated)}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs max-w-[160px] truncate">
                          {payment.notes ?? <span className="text-gray-200">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-3">
                            {unallocated > 0 && (
                              <button
                                onClick={() => openAllocate(payment)}
                                disabled={allocatingId === payment.id}
                                className="text-blue-600 hover:text-blue-700 font-medium transition-colors disabled:opacity-50"
                              >
                                {allocatingId === payment.id ? "…" : "Allocate"}
                              </button>
                            )}
                            <button
                              onClick={() => setViewingPayment(payment)}
                              className="text-gray-600 hover:text-gray-900 font-medium transition-colors"
                            >
                              View
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
            <p className="text-xs text-gray-400">
              Showing {showingFrom}-{showingTo} of {filteredPayments.length} payment
              {filteredPayments.length !== 1 ? "s" : ""}
            </p>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-gray-500">
                Rows per page
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="px-2 py-1 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                  className="px-2.5 py-1 text-xs font-medium text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
                >
                  Previous
                </button>
                <span className="text-xs text-gray-500">
                  Page {safePage} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="px-2.5 py-1 text-xs font-medium text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
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
