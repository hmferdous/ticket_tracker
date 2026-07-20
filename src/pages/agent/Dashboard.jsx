import { useEffect, useMemo, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import AppLayout from "../../components/layout/AppLayout"
import { clientOutstanding, clientOwedBack, ticketNetMargin, ticketEffectiveSale } from "../../lib/refunds"

function fmt(n) {
  return Number(n ?? 0).toLocaleString("en-BD")
}

function fmtDate(d) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function supplierAmountPaid(t) {
  return (t.ticket_payments ?? [])
    .filter((tp) => tp.type === "supplier")
    .reduce((sum, tp) => sum + (tp.allocated_amount ?? 0), 0)
}

function daysUntilFlight(travelDate) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const travel = new Date(travelDate)
  travel.setHours(0, 0, 0, 0)
  return Math.round((travel - today) / 86400000)
}

function paymentStatusBadge(status) {
  if (status === "unpaid") return { label: "Unpaid", cls: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" }
  if (status === "partial") return { label: "Partial", cls: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400" }
  if (status === "paid") return { label: "Paid", cls: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" }
  return { label: status ?? "—", cls: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400" }
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

function Badge({ label, className }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${className}`}>
      {label}
    </span>
  )
}

function StatCard({ label, value, accent, tag }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 flex flex-col">
      <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums flex-1 ${accent ?? "text-gray-900 dark:text-gray-100"}`}>{value}</p>
      {tag && (
        <span className="mt-3 self-start inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500">
          {tag}
        </span>
      )}
    </div>
  )
}

const PRESETS = [
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "last_quarter", label: "Last Quarter" },
  { value: "this_year", label: "This Year" },
  { value: "all_time", label: "All Time" },
  { value: "custom", label: "Custom" },
]

function getPresetRange(preset) {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()

  switch (preset) {
    case "this_month":
      return [
        new Date(y, m, 1).toISOString().slice(0, 10),
        new Date(y, m + 1, 0).toISOString().slice(0, 10),
      ]
    case "last_month":
      return [
        new Date(y, m - 1, 1).toISOString().slice(0, 10),
        new Date(y, m, 0).toISOString().slice(0, 10),
      ]
    case "this_quarter": {
      const qs = Math.floor(m / 3) * 3
      return [
        new Date(y, qs, 1).toISOString().slice(0, 10),
        new Date(y, qs + 3, 0).toISOString().slice(0, 10),
      ]
    }
    case "last_quarter": {
      const qs = Math.floor(m / 3) * 3 - 3
      const qy = qs < 0 ? y - 1 : y
      const qsa = ((qs % 12) + 12) % 12
      return [
        new Date(qy, qsa, 1).toISOString().slice(0, 10),
        new Date(qy, qsa + 3, 0).toISOString().slice(0, 10),
      ]
    }
    case "this_year":
      return [
        new Date(y, 0, 1).toISOString().slice(0, 10),
        new Date(y, 11, 31).toISOString().slice(0, 10),
      ]
    default:
      return [null, null]
  }
}

function DashboardSkeleton() {
  return (
    <div className="max-w-screen-xl mx-auto px-6 py-8">
      <div className="flex gap-2 mb-4">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-8 w-24 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 animate-pulse">
            <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
            <div className="h-7 w-20 bg-gray-100 dark:bg-gray-800 rounded" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 animate-pulse">
            <div className="h-3 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
            <div className="h-7 w-20 bg-gray-100 dark:bg-gray-800 rounded" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 animate-pulse">
            <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
            <div className="h-7 w-20 bg-gray-100 dark:bg-gray-800 rounded" />
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 mb-6 animate-pulse">
        <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
        <div className="space-y-2">
          <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded" />
          <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded" />
          <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 animate-pulse">
            <div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
            <div className="space-y-2">
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded" />
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded" />
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded" />
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { agent } = useAuth()
  const [tickets, setTickets] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [amountsVisible, setAmountsVisible] = useState(true)

  const [filterPreset, setFilterPreset] = useState("this_month")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")

  useEffect(() => {
    if (agent?.id) fetchDashboardData()
  }, [agent])

  const fetchDashboardData = async () => {
    setLoading(true)
    setError("")

    const [ticketsRes, paymentsRes] = await Promise.all([
      supabase
        .from("tickets")
        .select(
          `id, passenger_name, route, travel_date, issue_date, sell_price, purchase_price, amount_paid, payment_status,
           is_void, refund_status, refund_receivable, refund_received, refund_payable, refund_paid,
           airlines_penalty, fare_difference, reissue_margin, commission,
           void_fee_collected, void_fee_paid,
           office_markup, client_id, clients(name), ticket_payments(allocated_amount, type), created_at`
        )
        .eq("agent_id", agent.id)
        .is("archived_at", null),
      supabase
        .from("payments")
        .select(
          `id, type, amount, unallocated_amount, channel, payment_date, client_id, supplier_id, clients(name), suppliers(name)`
        )
        .eq("agent_id", agent.id)
        .order("payment_date", { ascending: false }),
    ])

    setLoading(false)

    if (ticketsRes.error) { setError(ticketsRes.error.message); return }
    if (paymentsRes.error) { setError(paymentsRes.error.message); return }

    setTickets(ticketsRes.data ?? [])
    setPayments(paymentsRes.data ?? [])
  }

  // Derive active date range
  const [dateFrom, dateTo] = useMemo(() => {
    if (filterPreset === "custom") return [customFrom || null, customTo || null]
    return getPresetRange(filterPreset)
  }, [filterPreset, customFrom, customTo])

  // Period-filtered subsets (drive the period stat cards + recent tables)
  const filteredTickets = useMemo(() => {
    if (!dateFrom && !dateTo) return tickets
    return tickets.filter((t) => {
      const d = t.issue_date
      if (!d) return false
      if (dateFrom && d < dateFrom) return false
      if (dateTo && d > dateTo) return false
      return true
    })
  }, [tickets, dateFrom, dateTo])

  const filteredPayments = useMemo(() => {
    if (!dateFrom && !dateTo) return payments
    return payments.filter((p) => {
      const d = p.payment_date
      if (!d) return false
      if (dateFrom && d < dateFrom) return false
      if (dateTo && d > dateTo) return false
      return true
    })
  }, [payments, dateFrom, dateTo])

  // Period stats — affected by date filter
  const periodStats = useMemo(() => ({
    totalTickets: filteredTickets.length,
    totalRevenue: filteredTickets.reduce((sum, t) => sum + ticketEffectiveSale(t), 0),
    totalMargin: filteredTickets.reduce((sum, t) => sum + ticketNetMargin(t), 0),
    officeMargin: filteredTickets.reduce((sum, t) => sum + (t.office_markup ?? 0), 0),
  }), [filteredTickets])

  const totalCollected = useMemo(
    () => filteredPayments.filter((p) => p.type === "client_payment").reduce((sum, p) => sum + (p.amount ?? 0), 0),
    [filteredPayments]
  )

  // Cumulative stats — always all-time, never filtered
  const cumulativeStats = useMemo(() => {
    // Client-side outstanding nets sell_price/amount_paid against
    // refund_payable via clientOutstanding — this degrades to the ordinary
    // sell_price - amount_paid for a ticket with no refund at all (refund_payable
    // is null there), so it can safely apply to every non-void ticket without
    // a separate "unpaid/partial" pre-filter or a refund_status exclusion.
    const outstandingReceivable = tickets
      .filter((t) => !t.is_void)
      .reduce((sum, t) => sum + clientOutstanding(t), 0)

    // Supplier side doesn't have the same "hadn't paid yet" ambiguity a
    // refund can introduce on the client side — once a ticket is refund-active,
    // the remaining purchase_price obligation is extinguished, not reduced to
    // a new target (a pre-payment credit adjustment is a void fee, not a
    // refund). So this stays excluded entirely rather than netted.
    const supplierOutstandingEligible = (t) => !t.is_void && t.refund_status == null
    const totalPayableToSuppliers = tickets
      .filter(supplierOutstandingEligible)
      .reduce((sum, t) => sum + Math.max((t.purchase_price ?? 0) - supplierAmountPaid(t), 0), 0)
    const officeMarkupContributed = tickets.reduce((sum, t) => sum + (t.office_markup ?? 0), 0)
    return { outstandingReceivable, totalPayableToSuppliers, officeMarkupContributed }
  }, [tickets])

  const unallocatedClientCredit = useMemo(
    () => payments.filter((p) => p.type === "client_payment").reduce((sum, p) => sum + (p.unallocated_amount ?? 0), 0),
    [payments]
  )

  // The refund lifecycle has 4 states: initiated -> supplier_refunded or
  // client_refunded (whichever side settles first) -> closed. Filtering by
  // exact status string misses whichever intermediate state isn't named —
  // these check the actual field that's still null instead, so a refund
  // stays visible regardless of which side settled first.
  const refundStats = useMemo(() => ({
    openCount: tickets.filter((t) => t.refund_status != null && t.refund_status !== "closed").length,
    // Remaining balance, not "untouched" — refund_received/refund_paid are
    // cumulative totals now, so a partial receipt still leaves a remainder
    // that should keep counting here, not just an all-or-nothing null check.
    awaitingFromSupplier: tickets
      .filter((t) => t.refund_status != null)
      .reduce((sum, t) => sum + Math.max((t.refund_receivable ?? 0) - (t.refund_received ?? 0), 0), 0),
    owedToClients: tickets
      .filter((t) => t.refund_status != null)
      .reduce((sum, t) => sum + clientOwedBack(t), 0),
    netMargin: tickets
      .filter((t) => t.refund_status === "closed")
      .reduce((sum, t) => sum + ((t.refund_receivable ?? 0) - (t.refund_payable ?? 0)), 0),
  }), [tickets])

  // Ticket-level refund_paid, not the payments table — a client refund
  // recorded via the ticket-row "Record Client Refund" action never creates
  // a payments row (see RefundModal), so summing payments.client_refund
  // undercounts. refund_paid is set by both recording paths.
  const totalRefundedToClients = useMemo(
    () => tickets.reduce((sum, t) => sum + (t.refund_paid ?? 0), 0),
    [tickets]
  )

  // Needs Attention — always all tickets, unaffected by filter
  const needsAttention = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10)
    return tickets
      .filter((t) => t.travel_date && t.travel_date >= todayStr && t.payment_status !== "paid" && !t.is_void)
      .map((t) => ({
        ...t,
        outstanding: (t.sell_price ?? 0) - (t.amount_paid ?? 0),
        daysUntil: daysUntilFlight(t.travel_date),
      }))
      .sort((a, b) => a.travel_date.localeCompare(b.travel_date))
  }, [tickets])

  // Recent tables — follow the period filter
  const recentTickets = useMemo(
    () => [...filteredTickets].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")).slice(0, 5),
    [filteredTickets]
  )

  const recentPayments = useMemo(() => filteredPayments.slice(0, 5), [filteredPayments])

  const headerActions = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setAmountsVisible((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg text-xs font-medium transition-colors"
      >
        {amountsVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        {amountsVisible ? "Hide amounts" : "Show amounts"}
      </button>
    </div>
  )

  const M = (n) => (amountsVisible ? fmt(n) : "•••••")
  const MA = (n) => (amountsVisible ? `${fmt(n)} BDT` : "•••••")

  return (
    <AppLayout title="Dashboard" actions={headerActions}>
      {loading ? (
        <DashboardSkeleton />
      ) : (
        <div className="max-w-screen-xl mx-auto px-6 py-8">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Welcome */}
          {agent && (
            <div className="mb-5">
              <p className="text-3xl font-semibold text-gray-900 dark:text-gray-100 tracking-tight">
                {(() => {
                  const h = new Date().getHours()
                  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
                  const name = agent.full_name?.split(" ")[0] || user?.email?.split("@")[0] || "there"
                  return `${greeting}, ${name}`
                })()}
              </p>
            </div>
          )}

          {/* Period filter bar */}
          <div className="flex flex-wrap items-center gap-2 mb-5">
            {PRESETS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilterPreset(value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filterPreset === value
                    ? "bg-blue-600 text-white"
                    : "border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                {label}
              </button>
            ))}
            {filterPreset === "custom" && (
              <div className="flex items-center gap-2 ml-1">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="px-2 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-gray-400 dark:text-gray-500 text-xs">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="px-2 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>

          {/* Row 1 — period-sensitive cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
            <StatCard label="Total Tickets" value={fmt(periodStats.totalTickets)} />
            <StatCard label="Total Sales" value={MA(periodStats.totalRevenue)} />
            <StatCard label="Total Collected" value={MA(totalCollected)} accent="text-green-600 dark:text-green-400" />
            <StatCard
              label="Total Profit"
              value={MA(periodStats.totalMargin)}
              accent={periodStats.totalMargin >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
            />
            <StatCard
              label="Office Margin"
              value={MA(periodStats.officeMargin)}
              accent={periodStats.officeMargin >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
            />
          </div>

          {/* Row 2 — cumulative / all-time cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <StatCard
              label="Collection Pending"
              value={MA(cumulativeStats.outstandingReceivable)}
              accent={cumulativeStats.outstandingReceivable > 0 ? "text-yellow-600 dark:text-yellow-400" : "text-gray-900 dark:text-gray-100"}
              tag="All time"
            />
            <StatCard
              label="Total Payable to Suppliers"
              value={MA(cumulativeStats.totalPayableToSuppliers)}
              accent={cumulativeStats.totalPayableToSuppliers > 0 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-gray-100"}
              tag="All time"
            />
            <StatCard
              label="Unallocated Client Credit"
              value={MA(unallocatedClientCredit)}
              accent={unallocatedClientCredit > 0 ? "text-blue-600 dark:text-blue-400" : "text-gray-900 dark:text-gray-100"}
              tag="All time"
            />
          </div>

          {/* Row 3 — Refund pipeline cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <StatCard
              label="Open Refunds"
              value={fmt(refundStats.openCount)}
              tag="All time"
            />
            <StatCard
              label="Awaiting from Supplier"
              value={MA(refundStats.awaitingFromSupplier)}
              accent={refundStats.awaitingFromSupplier > 0 ? "text-yellow-600 dark:text-yellow-400" : "text-gray-900 dark:text-gray-100"}
              tag="All time"
            />
            <StatCard
              label="Owed to Clients"
              value={MA(refundStats.owedToClients)}
              accent={refundStats.owedToClients > 0 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-gray-100"}
              tag="All time"
            />
            <StatCard
              label="Total Refunded to Clients"
              value={MA(totalRefundedToClients)}
              accent={totalRefundedToClients > 0 ? "text-blue-600 dark:text-blue-400" : "text-gray-900 dark:text-gray-100"}
            />
            <StatCard
              label="Refund Net Margin"
              value={MA(refundStats.netMargin)}
              accent={refundStats.netMargin >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
              tag="All time"
            />
          </div>

          {/* Row 4 — Needs Attention (always all tickets) */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 mb-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Needs Attention</h2>
            {needsAttention.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">No upcoming unpaid tickets</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
                      <th className="py-2 pr-4 font-medium">Passenger</th>
                      <th className="py-2 pr-4 font-medium">Route</th>
                      <th className="py-2 pr-4 font-medium">Travel Date</th>
                      <th className="py-2 pr-4 font-medium">Client</th>
                      <th className="py-2 pr-4 font-medium text-right">Outstanding</th>
                      <th className="py-2 pr-4 font-medium text-right">Days Until Flight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {needsAttention.map((t) => {
                      const rowCls = t.daysUntil <= 3 ? "bg-red-50 dark:bg-red-900/20" : t.daysUntil <= 7 ? "bg-yellow-50 dark:bg-yellow-900/20" : ""
                      return (
                        <tr key={t.id} className={`border-b border-gray-50 last:border-0 ${rowCls}`}>
                          <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">{t.passenger_name}</td>
                          <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{t.route}</td>
                          <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{fmtDate(t.travel_date)}</td>
                          <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{t.clients?.name ?? "—"}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-900 dark:text-gray-100">{M(t.outstanding)}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-900 dark:text-gray-100">{t.daysUntil}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Row 4 — Recent Tickets / Recent Payments (period-filtered) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Recent Tickets</h2>
              {recentTickets.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">No tickets in this period</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
                        <th className="py-2 pr-4 font-medium">Passenger</th>
                        <th className="py-2 pr-4 font-medium">Route</th>
                        <th className="py-2 pr-4 font-medium">Travel Date</th>
                        <th className="py-2 pr-4 font-medium text-right">Sell Price</th>
                        <th className="py-2 pr-4 font-medium text-right">Net Margin</th>
                        <th className="py-2 pr-4 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTickets.map((t) => {
                        const badge = paymentStatusBadge(t.payment_status)
                        return (
                          <tr key={t.id} className="border-b border-gray-50 last:border-0">
                            <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">{t.passenger_name}</td>
                            <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{t.route}</td>
                            <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{fmtDate(t.travel_date)}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-gray-900 dark:text-gray-100">{M(t.sell_price)}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-gray-900 dark:text-gray-100">{M(ticketNetMargin(t))}</td>
                            <td className="py-2 pr-4">
                              <Badge label={badge.label} className={badge.cls} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Recent Payments</h2>
              {recentPayments.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">No payments in this period</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
                        <th className="py-2 pr-4 font-medium">Date</th>
                        <th className="py-2 pr-4 font-medium">Party</th>
                        <th className="py-2 pr-4 font-medium text-right">Amount (BDT)</th>
                        <th className="py-2 pr-4 font-medium">Channel</th>
                        <th className="py-2 pr-4 font-medium">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentPayments.map((p) => {
                        const badge = typeBadge(p.type)
                        const party = p.clients?.name ?? p.suppliers?.name ?? "—"
                        return (
                          <tr key={p.id} className="border-b border-gray-50 last:border-0">
                            <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{fmtDate(p.payment_date)}</td>
                            <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">{party}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-gray-900 dark:text-gray-100">{M(p.amount)}</td>
                            <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{p.channel ?? "—"}</td>
                            <td className="py-2 pr-4">
                              <Badge label={badge.label} className={badge.cls} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
