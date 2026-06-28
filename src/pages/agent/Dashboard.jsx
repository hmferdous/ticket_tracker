import { useEffect, useMemo, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import AppLayout from "../../components/layout/AppLayout"

function fmt(n) {
  return Number(n ?? 0).toLocaleString("en-BD")
}

function fmtDate(d) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function ticketNetMargin(t) {
  const ticketMargin = (t.sell_price ?? 0) - (t.purchase_price ?? 0)
  const refundMargin = (t.refund_received ?? 0) - (t.refund_payable ?? 0)
  return ticketMargin + refundMargin
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
  if (status === "unpaid") return { label: "Unpaid", cls: "bg-red-100 text-red-700" }
  if (status === "partial") return { label: "Partial", cls: "bg-yellow-100 text-yellow-700" }
  if (status === "paid") return { label: "Paid", cls: "bg-green-100 text-green-700" }
  return { label: status ?? "—", cls: "bg-gray-100 text-gray-600" }
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

function Badge({ label, className }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${className}`}>
      {label}
    </span>
  )
}

function StatCard({ label, value, accent, tag }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums flex-1 ${accent ?? "text-gray-900"}`}>{value}</p>
      {tag && (
        <span className="mt-3 self-start inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-400">
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
          <div key={i} className="h-8 w-24 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-5 animate-pulse">
            <div className="h-3 w-24 bg-gray-200 rounded mb-3" />
            <div className="h-7 w-20 bg-gray-100 rounded" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-5 animate-pulse">
            <div className="h-3 w-32 bg-gray-200 rounded mb-3" />
            <div className="h-7 w-20 bg-gray-100 rounded" />
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 animate-pulse">
        <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
        <div className="space-y-2">
          <div className="h-4 bg-gray-100 rounded" />
          <div className="h-4 bg-gray-100 rounded" />
          <div className="h-4 bg-gray-100 rounded" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-5 animate-pulse">
            <div className="h-4 w-28 bg-gray-200 rounded mb-4" />
            <div className="space-y-2">
              <div className="h-4 bg-gray-100 rounded" />
              <div className="h-4 bg-gray-100 rounded" />
              <div className="h-4 bg-gray-100 rounded" />
              <div className="h-4 bg-gray-100 rounded" />
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
  const [seeding, setSeeding] = useState(false)
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
           is_void, refund_received, refund_payable, reissue_fee_collected, reissue_fee_paid, fare_difference,
           office_markup, client_id, clients(name), ticket_payments(allocated_amount, type), created_at`
        )
        .eq("agent_id", agent.id),
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
    totalRevenue: filteredTickets.reduce((sum, t) => sum + (t.sell_price ?? 0), 0),
    totalMargin: filteredTickets.reduce((sum, t) => sum + ticketNetMargin(t), 0),
    officeMargin: filteredTickets.reduce((sum, t) => sum + (t.office_markup ?? 0), 0),
  }), [filteredTickets])

  const totalCollected = useMemo(
    () => filteredPayments.filter((p) => p.type === "client_payment").reduce((sum, p) => sum + (p.amount ?? 0), 0),
    [filteredPayments]
  )

  // Cumulative stats — always all-time, never filtered
  const cumulativeStats = useMemo(() => {
    const outstandingReceivable = tickets
      .filter((t) => t.payment_status === "unpaid" || t.payment_status === "partial")
      .reduce((sum, t) => sum + ((t.sell_price ?? 0) - (t.amount_paid ?? 0)), 0)
    const totalPayableToSuppliers = tickets.reduce(
      (sum, t) => sum + Math.max((t.purchase_price ?? 0) - supplierAmountPaid(t), 0),
      0
    )
    const officeMarkupContributed = tickets.reduce((sum, t) => sum + (t.office_markup ?? 0), 0)
    return { outstandingReceivable, totalPayableToSuppliers, officeMarkupContributed }
  }, [tickets])

  const unallocatedClientCredit = useMemo(
    () => payments.filter((p) => p.type === "client_payment").reduce((sum, p) => sum + (p.unallocated_amount ?? 0), 0),
    [payments]
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

  const seedDashboardData = async () => {
    setSeeding(true)
    setError("")

    try {
      const addDays = (n) => {
        const d = new Date()
        d.setDate(d.getDate() + n)
        return d.toISOString().slice(0, 10)
      }

      const clientNames = [
        "[DEMO] Karim Traders",
        "[DEMO] Nasrin Akter",
        "[DEMO] Bashati Tours",
        "[DEMO] Rafiq Hossain",
        "[DEMO] Green Valley Travels",
      ]
      const supplierNames = ["[DEMO] Galileo GDS", "[DEMO] Air Connect BD", "[DEMO] Sky Bridge Travels"]

      const { data: existingClients } = await supabase
        .from("clients")
        .select("id, name")
        .eq("agent_id", agent.id)
        .in("name", clientNames)

      const missingClientNames = clientNames.filter(
        (n) => !(existingClients ?? []).some((c) => c.name === n)
      )
      if (missingClientNames.length) {
        await supabase.from("clients").insert(missingClientNames.map((name) => ({ agent_id: agent.id, name })))
      }

      const { data: allClients } = await supabase
        .from("clients")
        .select("id, name")
        .eq("agent_id", agent.id)
        .in("name", clientNames)

      const clientIdByName = {}
      for (const c of allClients ?? []) clientIdByName[c.name] = c.id

      const { data: existingSuppliers } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("agent_id", agent.id)
        .in("name", supplierNames)

      const missingSupplierNames = supplierNames.filter(
        (n) => !(existingSuppliers ?? []).some((s) => s.name === n)
      )
      if (missingSupplierNames.length) {
        await supabase
          .from("suppliers")
          .insert(missingSupplierNames.map((name) => ({ agent_id: agent.id, name })))
      }

      const { data: allSuppliers } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("agent_id", agent.id)
        .in("name", supplierNames)

      const supplierIdByName = {}
      for (const s of allSuppliers ?? []) supplierIdByName[s.name] = s.id

      const c1 = clientIdByName["[DEMO] Karim Traders"]
      const c2 = clientIdByName["[DEMO] Nasrin Akter"]
      const c3 = clientIdByName["[DEMO] Bashati Tours"]
      const c4 = clientIdByName["[DEMO] Rafiq Hossain"]
      const c5 = clientIdByName["[DEMO] Green Valley Travels"]

      const s1 = supplierIdByName["[DEMO] Galileo GDS"]
      const s2 = supplierIdByName["[DEMO] Air Connect BD"]
      const s3 = supplierIdByName["[DEMO] Sky Bridge Travels"]

      const base = (overrides) => ({
        agent_id: agent.id,
        ticket_number: null,
        issue_date: addDays(-5),
        return_date: null,
        gds_price: null,
        office_markup: null,
        status: "booked",
        refund_status: null,
        is_reissue: false,
        is_void: false,
        parent_ticket_id: null,
        refund_receivable: null,
        refund_received: null,
        refund_payable: null,
        refund_paid: null,
        reissue_fee_collected: null,
        reissue_fee_paid: null,
        fare_difference: null,
        amount_paid: 0,
        payment_status: "unpaid",
        narration: "Dashboard demo data — safe to delete",
        ...overrides,
      })

      const ticketSpecs = [
        base({ passenger_name: "Demo Passenger 01", route: "DAC-DXB", carrier: "BG", travel_date: addDays(2), client_id: c1, supplier_id: s1, purchase_price: 42000, sell_price: 50000 }),
        base({ passenger_name: "Demo Passenger 02", route: "DAC-JFK", carrier: "EK", travel_date: addDays(5), client_id: c2, supplier_id: s2, purchase_price: 95000, sell_price: 115000, gds_price: 90000, office_markup: 5000, amount_paid: 50000, payment_status: "partial", status: "collected" }),
        base({ passenger_name: "Demo Passenger 03", route: "DAC-LHR", carrier: "QR", travel_date: addDays(1), client_id: c3, supplier_id: s3, purchase_price: 88000, sell_price: 102000, gds_price: 85000, office_markup: 3000, amount_paid: 102000, payment_status: "paid", status: "collected" }),
        base({ passenger_name: "Demo Passenger 04", route: "DAC-BKK", carrier: "TG", travel_date: addDays(10), client_id: c4, supplier_id: s1, purchase_price: 32000, sell_price: 39000 }),
        base({ passenger_name: "Demo Passenger 05", route: "DAC-SIN", carrier: "SQ", travel_date: addDays(20), client_id: c5, supplier_id: s2, purchase_price: 70000, sell_price: 85000, amount_paid: 40000, payment_status: "partial" }),
        base({ passenger_name: "Demo Passenger 06", route: "DAC-KUL", carrier: "MH", travel_date: addDays(-3), return_date: addDays(7), client_id: c1, supplier_id: s3, purchase_price: 58000, sell_price: 70000, amount_paid: 70000, payment_status: "paid", status: "supplier_paid" }),
        base({ passenger_name: "Demo Passenger 07", route: "DAC-CXB", carrier: "BG", travel_date: addDays(-10), client_id: c2, supplier_id: s1, purchase_price: 8000, sell_price: 11000, amount_paid: 11000, payment_status: "paid", status: "flown" }),
        base({ passenger_name: "Demo Passenger 08", route: "DAC-DEL", carrier: "AI", travel_date: addDays(-20), return_date: addDays(-15), client_id: c3, supplier_id: s2, purchase_price: 26000, sell_price: 33000, amount_paid: 15000, payment_status: "partial", status: "flown" }),
        base({ passenger_name: "Demo Passenger 09", route: "DAC-AUH", carrier: "EK", travel_date: addDays(-60), client_id: c4, supplier_id: s3, purchase_price: 64000, sell_price: 78000, gds_price: 60000, office_markup: 4000, amount_paid: 78000, payment_status: "paid", status: "flown" }),
        base({ passenger_name: "Demo Passenger 10", route: "DAC-CCU", carrier: "BG", travel_date: addDays(-15), client_id: c5, supplier_id: s1, purchase_price: 9000, sell_price: 13000, status: "void", is_void: true }),
        base({ passenger_name: "Demo Passenger 11", route: "DAC-DOH", carrier: "QR", travel_date: addDays(-30), client_id: c1, supplier_id: s2, purchase_price: 75000, sell_price: 90000, amount_paid: 90000, payment_status: "paid", status: "flown", refund_status: "initiated", refund_receivable: 70000, refund_payable: 65000 }),
        base({ passenger_name: "Demo Passenger 12", route: "DAC-JED", carrier: "SV", travel_date: addDays(-45), client_id: c2, supplier_id: s3, purchase_price: 53000, sell_price: 64000, amount_paid: 64000, payment_status: "paid", status: "closed", refund_status: "closed", refund_receivable: 50000, refund_received: 48000, refund_payable: 44000, refund_paid: 44000 }),
        base({ passenger_name: "Demo Passenger 13", route: "DAC-IST", carrier: "TK", travel_date: addDays(30), client_id: c3, supplier_id: s1, purchase_price: 82000, sell_price: 99000, amount_paid: 99000, payment_status: "paid" }),
        base({ passenger_name: "Demo Passenger 14", route: "DAC-COX", carrier: "BS", travel_date: addDays(3), client_id: c4, supplier_id: s2, purchase_price: 6000, sell_price: 9000 }),
        base({ passenger_name: "Demo Passenger 15", route: "DAC-MCT", carrier: "WY", travel_date: addDays(7), client_id: c5, supplier_id: s3, purchase_price: 45000, sell_price: 55000 }),
      ]

      const { data: insertedTickets, error: ticketsError } = await supabase
        .from("tickets")
        .insert(ticketSpecs)
        .select("id, passenger_name, client_id, supplier_id")

      if (ticketsError) throw ticketsError

      const paymentSpecs = [
        { agent_id: agent.id, client_id: c2, type: "client_payment", amount: 50000, unallocated_amount: 0, channel: "bKash", trx_id: "DEMOTRX01", notes: "Demo dashboard data", payment_date: addDays(0) },
        { agent_id: agent.id, client_id: c3, type: "client_payment", amount: 102000, unallocated_amount: 0, channel: "Bank", trx_id: "DEMOTRX02", notes: "Demo dashboard data", payment_date: addDays(-1) },
        { agent_id: agent.id, client_id: c5, type: "client_payment", amount: 40000, unallocated_amount: 0, channel: "bKash", trx_id: "DEMOTRX03", notes: "Demo dashboard data", payment_date: addDays(-2) },
        { agent_id: agent.id, supplier_id: s1, type: "supplier_payment", amount: 42000, unallocated_amount: 0, channel: "Bank", trx_id: "DEMOTRX04", notes: "Demo dashboard data", payment_date: addDays(-3) },
        { agent_id: agent.id, supplier_id: s2, type: "supplier_payment", amount: 60000, unallocated_amount: 0, channel: "Bank", trx_id: "DEMOTRX05", notes: "Demo dashboard data", payment_date: addDays(-4) },
        { agent_id: agent.id, client_id: c4, type: "client_payment", amount: 5000, unallocated_amount: 5000, channel: "Cash", trx_id: null, notes: "Unallocated credit", payment_date: addDays(-5) },
        { agent_id: agent.id, client_id: c2, type: "client_refund", amount: 44000, unallocated_amount: 0, channel: "Bank", trx_id: "DEMOTRX06", notes: "Demo dashboard data", payment_date: addDays(-6) },
        { agent_id: agent.id, supplier_id: s3, type: "supplier_refund", amount: 48000, unallocated_amount: 0, channel: "Bank", trx_id: "DEMOTRX07", notes: "Demo dashboard data", payment_date: addDays(-7) },
      ]

      const { data: insertedPayments, error: paymentsError } = await supabase
        .from("payments")
        .insert(paymentSpecs)
        .select("id")

      if (paymentsError) throw paymentsError

      const ticketPaymentRows = [
        { payment_id: insertedPayments[0].id, ticket_id: insertedTickets[1].id, allocated_amount: 50000, type: "client" },
        { payment_id: insertedPayments[1].id, ticket_id: insertedTickets[2].id, allocated_amount: 102000, type: "client" },
        { payment_id: insertedPayments[2].id, ticket_id: insertedTickets[4].id, allocated_amount: 40000, type: "client" },
        { payment_id: insertedPayments[3].id, ticket_id: insertedTickets[0].id, allocated_amount: 42000, type: "supplier" },
        { payment_id: insertedPayments[4].id, ticket_id: insertedTickets[1].id, allocated_amount: 60000, type: "supplier" },
      ]

      const { error: tpError } = await supabase.from("ticket_payments").insert(ticketPaymentRows)
      if (tpError) throw tpError

      await fetchDashboardData()
    } catch (err) {
      setError(err.message ?? "Seeding failed.")
    } finally {
      setSeeding(false)
    }
  }

  const headerActions = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setAmountsVisible((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg text-xs font-medium transition-colors"
      >
        {amountsVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        {amountsVisible ? "Hide amounts" : "Show amounts"}
      </button>
      {import.meta.env.DEV && (
        <button
          type="button"
          onClick={seedDashboardData}
          disabled={seeding}
          className="px-3 py-1.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-60 text-white rounded-lg text-xs font-medium transition-colors"
        >
          {seeding ? "Seeding…" : "Seed Demo Data"}
        </button>
      )}
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
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
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
                    : "border border-gray-200 text-gray-600 hover:bg-gray-50"
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
                  className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-gray-400 text-xs">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>

          {/* Row 1 — period-sensitive cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
            <StatCard label="Total Tickets" value={fmt(periodStats.totalTickets)} />
            <StatCard label="Total Sales" value={MA(periodStats.totalRevenue)} />
            <StatCard label="Total Collected" value={MA(totalCollected)} accent="text-green-600" />
            <StatCard
              label="Total Profit"
              value={MA(periodStats.totalMargin)}
              accent={periodStats.totalMargin >= 0 ? "text-green-600" : "text-red-600"}
            />
            <StatCard
              label="Office Margin"
              value={MA(periodStats.officeMargin)}
              accent={periodStats.officeMargin >= 0 ? "text-green-600" : "text-red-600"}
            />
          </div>

          {/* Row 2 — cumulative / all-time cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <StatCard
              label="Collection Pending"
              value={MA(cumulativeStats.outstandingReceivable)}
              accent={cumulativeStats.outstandingReceivable > 0 ? "text-yellow-600" : "text-gray-900"}
              tag="All time"
            />
            <StatCard
              label="Total Payable to Suppliers"
              value={MA(cumulativeStats.totalPayableToSuppliers)}
              accent={cumulativeStats.totalPayableToSuppliers > 0 ? "text-red-600" : "text-gray-900"}
              tag="All time"
            />
            <StatCard
              label="Unallocated Client Credit"
              value={MA(unallocatedClientCredit)}
              accent={unallocatedClientCredit > 0 ? "text-blue-600" : "text-gray-900"}
              tag="All time"
            />
          </div>

          {/* Row 3 — Needs Attention (always all tickets) */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Needs Attention</h2>
            {needsAttention.length === 0 ? (
              <p className="text-sm text-gray-400">No upcoming unpaid tickets</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
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
                      const rowCls = t.daysUntil <= 3 ? "bg-red-50" : t.daysUntil <= 7 ? "bg-yellow-50" : ""
                      return (
                        <tr key={t.id} className={`border-b border-gray-50 last:border-0 ${rowCls}`}>
                          <td className="py-2 pr-4 text-gray-900">{t.passenger_name}</td>
                          <td className="py-2 pr-4 text-gray-600">{t.route}</td>
                          <td className="py-2 pr-4 text-gray-600">{fmtDate(t.travel_date)}</td>
                          <td className="py-2 pr-4 text-gray-600">{t.clients?.name ?? "—"}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-900">{M(t.outstanding)}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-900">{t.daysUntil}</td>
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
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Recent Tickets</h2>
              {recentTickets.length === 0 ? (
                <p className="text-sm text-gray-400">No tickets in this period</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
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
                            <td className="py-2 pr-4 text-gray-900">{t.passenger_name}</td>
                            <td className="py-2 pr-4 text-gray-600">{t.route}</td>
                            <td className="py-2 pr-4 text-gray-600">{fmtDate(t.travel_date)}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-gray-900">{M(t.sell_price)}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-gray-900">{M(ticketNetMargin(t))}</td>
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

            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Recent Payments</h2>
              {recentPayments.length === 0 ? (
                <p className="text-sm text-gray-400">No payments in this period</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
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
                            <td className="py-2 pr-4 text-gray-600">{fmtDate(p.payment_date)}</td>
                            <td className="py-2 pr-4 text-gray-900">{party}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-gray-900">{M(p.amount)}</td>
                            <td className="py-2 pr-4 text-gray-600">{p.channel ?? "—"}</td>
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
