import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import TicketModal from "../../components/tickets/TicketModal"
import VoidConfirmModal from "../../components/tickets/VoidConfirmModal"
import RefundModal from "../../components/tickets/RefundModal"
import ReissueModal from "../../components/tickets/ReissueModal"
import RecordPaymentModal from "../../components/tickets/RecordPaymentModal"
import TicketDetailModal from "../../components/tickets/TicketDetailModal"
import SearchableDropdown from "../../components/ui/SearchableDropdown"
import AppLayout from "../../components/layout/AppLayout"
import { AIRLINES } from "../../lib/airlines"

// Row-level actions available for a ticket, based on its current state
function getRowActions(ticket) {
  const notVoid = ticket.status !== "void"
  const notReissued = ticket.status !== "reissued"
  const actions = []

  if (notVoid && notReissued && ticket.refund_status !== "closed") actions.push("void")
  if (notVoid && notReissued && ticket.refund_status === null) actions.push("refund")
  if (notVoid && notReissued && ticket.refund_status !== "initiated") actions.push("reissue")
  if (ticket.payment_status !== "paid" && notVoid) actions.push("record_payment")

  if (ticket.refund_status && ticket.refund_status !== "closed") {
    if (ticket.refund_received == null) actions.push("record_supplier_refund")
    if (ticket.refund_paid == null) actions.push("record_client_refund")
  }

  actions.push("view")
  return actions
}

const AIRLINE_FILTER_OPTIONS = [
  { value: "", label: "All Airlines" },
  ...AIRLINES.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` })),
]

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200]

const STATUS_CHIP_OPTIONS = [
  "Unpaid",
  "Partial",
  "Paid",
  "Upcoming",
  "Flying today",
  "Flown",
  "Return pending",
  "Void",
  "Reissued",
  "Refund",
  "Refunded",
]

function Badge({ label, className }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${className}`}>
      {label}
    </span>
  )
}

function computeChips(ticket) {
  const today = new Date().toISOString().split("T")[0]
  const chips = []

  // Payment chips
  if (ticket.payment_status === "unpaid") {
    chips.push({ label: "Unpaid", cls: "bg-red-100 text-red-700" })
  } else if (ticket.payment_status === "partial") {
    chips.push({ label: "Partial", cls: "bg-yellow-100 text-yellow-700" })
  } else if (ticket.payment_status === "paid") {
    chips.push({ label: "Paid", cls: "bg-green-100 text-green-700" })
  }

  // Flight chips — based on travel_date and return_date
  if (ticket.travel_date) {
    if (ticket.travel_date > today) {
      chips.push({ label: "Upcoming", cls: "bg-blue-100 text-blue-700" })
    } else if (ticket.travel_date === today) {
      chips.push({ label: "Flying today", cls: "bg-purple-100 text-purple-700" })
    } else if (ticket.return_date && ticket.return_date >= today) {
      chips.push({ label: "Return pending", cls: "bg-orange-100 text-orange-700" })
    } else {
      chips.push({ label: "Flown", cls: "bg-gray-100 text-gray-500" })
    }
  }

  // Lifecycle chips
  if (ticket.is_void) {
    chips.push({ label: "Void", cls: "bg-gray-100 text-gray-500" })
  }
  if (ticket.status === "reissued") {
    chips.push({ label: "Reissued", cls: "bg-orange-100 text-orange-700" })
  }
  if (ticket.is_reissue) {
    chips.push({ label: "Reissue", cls: "bg-blue-100 text-blue-700" })
  }
  if (ticket.refund_status === "initiated") {
    chips.push({ label: "Refund", cls: "bg-yellow-100 text-yellow-700" })
  }
  if (ticket.refund_status === "closed") {
    chips.push({ label: "Refunded", cls: "bg-red-100 text-red-700" })
  }

  return chips
}

function TicketChips({ ticket }) {
  const chips = computeChips(ticket)
  if (chips.length === 0) return <span className="text-gray-300 text-xs">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((chip, i) => (
        <Badge key={i} label={chip.label} className={chip.cls} />
      ))}
    </div>
  )
}

function RowActionsMenu({ items, isOpen, onToggle, onClose }) {
  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={onToggle}
        className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        aria-label="Row actions"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={onClose} />
          <div className="absolute right-0 top-full z-20 mt-1 w-52 bg-white rounded-lg shadow-lg border border-gray-100 py-1">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  onClose()
                  item.onClick()
                }}
                className={`block w-full text-left px-3 py-2 text-sm font-medium hover:bg-gray-50 transition-colors ${item.cls}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function fmt(n) {
  if (n == null) return "—"
  return Number(n).toLocaleString("en-BD")
}

function fmtMargin(n) {
  if (n == null || isNaN(n)) return "—"
  return Number(n).toLocaleString("en-BD")
}

function computeNetMargin(ticket) {
  const ticketMargin = (ticket.sell_price ?? 0) - (ticket.purchase_price ?? 0)
  const refundMargin = (ticket.refund_received ?? 0) - (ticket.refund_payable ?? 0)
  return ticketMargin + refundMargin
}

export default function Tickets() {
  const { agent } = useAuth()

  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTicket, setEditingTicket] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [seeding, setSeeding] = useState(false)

  // Row-level action modals
  const [voidingTicket, setVoidingTicket] = useState(null)
  const [refundModal, setRefundModal] = useState(null) // { ticket, mode: 'initiate' | 'supplier' | 'client' }
  const [reissuingTicket, setReissuingTicket] = useState(null)
  const [recordPaymentTicket, setRecordPaymentTicket] = useState(null)
  const [viewingTicket, setViewingTicket] = useState(null)
  const [openActionMenuId, setOpenActionMenuId] = useState(null)

  // Filter dropdown data
  const [clients, setClients] = useState([])
  const [suppliers, setSuppliers] = useState([])

  // Filter state
  const [searchText, setSearchText] = useState("")
  const [airlineFilter, setAirlineFilter] = useState("")
  const [clientFilter, setClientFilter] = useState("")
  const [supplierFilter, setSupplierFilter] = useState("")
  const [selectedChips, setSelectedChips] = useState([])
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  // Pagination state
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  useEffect(() => {
    if (agent?.id) {
      fetchTickets()
      fetchFilterOptions()
    }
  }, [agent])

  // Reset to page 1 whenever any filter changes
  useEffect(() => {
    setPage(1)
  }, [searchText, airlineFilter, clientFilter, supplierFilter, selectedChips, dateFrom, dateTo])

  const fetchTickets = async () => {
    setLoading(true)
    setError("")
    const { data, error } = await supabase
      .from("tickets")
      .select(`
        id, passenger_name, route, pnr, travel_date, return_date, issue_date, carrier, narration,
        purchase_price, gds_price, sell_price,
        amount_paid, payment_status, status, refund_status,
        is_reissue, is_void, parent_ticket_id,
        refund_received, refund_payable,
        reissue_fee_collected, reissue_fee_paid, fare_difference,
        client_id, supplier_id,
        clients(name),
        suppliers(name),
        created_at
      `)
      .eq("agent_id", agent.id)
      .order("issue_date", { ascending: false, nullsFirst: false })

    setLoading(false)
    if (error) setError(error.message)
    else setTickets(data)
  }

  const fetchFilterOptions = async () => {
    const [{ data: c }, { data: s }] = await Promise.all([
      supabase.from("clients").select("id, name").eq("agent_id", agent.id).order("name"),
      supabase.from("suppliers").select("id, name").eq("agent_id", agent.id).order("name"),
    ])
    setClients(c ?? [])
    setSuppliers(s ?? [])
  }

  const toggleChip = (chip) => {
    setSelectedChips((prev) =>
      prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip]
    )
  }

  const clearFilters = () => {
    setSearchText("")
    setAirlineFilter("")
    setClientFilter("")
    setSupplierFilter("")
    setSelectedChips([])
    setDateFrom("")
    setDateTo("")
  }

  const filteredTickets = useMemo(() => {
    const search = searchText.trim().toLowerCase()
    return tickets.filter((ticket) => {
      if (search) {
        const haystack = `${ticket.passenger_name ?? ""} ${ticket.pnr ?? ""} ${ticket.route ?? ""}`.toLowerCase()
        if (!haystack.includes(search)) return false
      }
      if (airlineFilter && ticket.carrier !== airlineFilter) return false
      if (clientFilter && ticket.client_id !== clientFilter) return false
      if (supplierFilter && ticket.supplier_id !== supplierFilter) return false
      if (dateFrom && (!ticket.issue_date || ticket.issue_date < dateFrom)) return false
      if (dateTo && (!ticket.issue_date || ticket.issue_date > dateTo)) return false
      if (selectedChips.length > 0) {
        const labels = computeChips(ticket).map((c) => c.label)
        if (!selectedChips.some((chip) => labels.includes(chip))) return false
      }
      return true
    })
  }, [tickets, searchText, airlineFilter, clientFilter, supplierFilter, dateFrom, dateTo, selectedChips])

  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const startIdx = (safePage - 1) * pageSize
  const pagedTickets = filteredTickets.slice(startIdx, startIdx + pageSize)
  const showingFrom = filteredTickets.length === 0 ? 0 : startIdx + 1
  const showingTo = Math.min(startIdx + pageSize, filteredTickets.length)

  // TEMPORARY — seeds 15 varied dummy tickets (covering every chip combination) for filter/pagination testing.
  // Remove this function and its button once testing is done.
  const seedTestData = async () => {
    if (!agent?.id) return
    setSeeding(true)
    setError("")
    try {
      const today = new Date()
      const addDays = (n) => {
        const d = new Date(today)
        d.setDate(d.getDate() + n)
        return d.toISOString().split("T")[0]
      }
      const todayStr = addDays(0)

      const testClientNames = ["[TEST] Karim Traders", "[TEST] Walk-in Passenger", "[TEST] Bashati Tours"]
      const testSupplierNames = ["[TEST] Galileo GDS", "[TEST] Air Connect BD"]

      const existingClientNames = new Set(clients.map((c) => c.name))
      const missingClients = testClientNames.filter((n) => !existingClientNames.has(n))
      if (missingClients.length) {
        await supabase.from("clients").insert(missingClients.map((name) => ({ name, agent_id: agent.id })))
      }
      const existingSupplierNames = new Set(suppliers.map((s) => s.name))
      const missingSuppliers = testSupplierNames.filter((n) => !existingSupplierNames.has(n))
      if (missingSuppliers.length) {
        await supabase.from("suppliers").insert(missingSuppliers.map((name) => ({ name, agent_id: agent.id })))
      }

      const [{ data: clientRows }, { data: supplierRows }] = await Promise.all([
        supabase.from("clients").select("id, name").eq("agent_id", agent.id).in("name", testClientNames),
        supabase.from("suppliers").select("id, name").eq("agent_id", agent.id).in("name", testSupplierNames),
      ])
      const clientIdByName = Object.fromEntries((clientRows ?? []).map((c) => [c.name, c.id]))
      const supplierIdByName = Object.fromEntries((supplierRows ?? []).map((s) => [s.name, s.id]))
      const [c1, c2, c3] = testClientNames.map((n) => clientIdByName[n])
      const [s1, s2] = testSupplierNames.map((n) => supplierIdByName[n])

      const base = (overrides) => ({
        agent_id: agent.id,
        ticket_number: null,
        issue_date: addDays(-3),
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
        narration: "Seed test ticket — safe to delete",
        ...overrides,
      })

      // First batch — last entry (#13) becomes the reissue parent so #14 can reference its id
      const firstBatchSpecs = [
        { ticket: base({ passenger_name: "Test Passenger 01", carrier: "BG", pnr: "TSTPNR01", route: "DAC-DXB", travel_date: addDays(45), client_id: c1, supplier_id: s1, purchase_price: 42000, sell_price: 50000 }), payment: null },
        { ticket: base({ passenger_name: "Test Passenger 02", carrier: "EK", pnr: "TSTPNR02", route: "DAC-JFK", travel_date: addDays(30), client_id: c2, supplier_id: s2, purchase_price: 95000, sell_price: 115000, status: "collected" }), payment: 50000 },
        { ticket: base({ passenger_name: "Test Passenger 03", carrier: "QR", pnr: "TSTPNR03", route: "DAC-LHR", travel_date: addDays(20), client_id: c1, supplier_id: s1, purchase_price: 88000, sell_price: 102000, status: "collected" }), payment: 102000 },
        { ticket: base({ passenger_name: "Test Passenger 04", carrier: "TG", pnr: "TSTPNR04", route: "DAC-BKK", travel_date: todayStr, client_id: c3, supplier_id: s2, purchase_price: 32000, sell_price: 39000 }), payment: null },
        { ticket: base({ passenger_name: "Test Passenger 05", carrier: "SQ", pnr: "TSTPNR05", route: "DAC-SIN", travel_date: addDays(-5), return_date: addDays(10), client_id: c2, supplier_id: s1, purchase_price: 70000, sell_price: 85000, status: "supplier_paid" }), payment: 30000 },
        { ticket: base({ passenger_name: "Test Passenger 06", carrier: "MH", pnr: "TSTPNR06", route: "DAC-KUL", travel_date: addDays(-3), return_date: addDays(7), client_id: c1, supplier_id: s2, purchase_price: 58000, sell_price: 70000, status: "supplier_paid" }), payment: 70000 },
        { ticket: base({ passenger_name: "Test Passenger 07", carrier: "BG", pnr: "TSTPNR07", route: "DAC-CXB", travel_date: addDays(-30), client_id: c3, supplier_id: s1, purchase_price: 8000, sell_price: 11000, status: "flown" }), payment: null },
        { ticket: base({ passenger_name: "Test Passenger 08", carrier: "AI", pnr: "TSTPNR08", route: "DAC-DEL", travel_date: addDays(-20), return_date: addDays(-15), client_id: c2, supplier_id: s1, purchase_price: 26000, sell_price: 33000, status: "flown" }), payment: 15000 },
        { ticket: base({ passenger_name: "Test Passenger 09", carrier: "EK", pnr: "TSTPNR09", route: "DAC-AUH", travel_date: addDays(-60), client_id: c1, supplier_id: s2, purchase_price: 64000, sell_price: 78000, status: "flown" }), payment: 78000 },
        { ticket: base({ passenger_name: "Test Passenger 10", carrier: "BG", pnr: "TSTPNR10", route: "DAC-CCU", travel_date: addDays(-10), client_id: c3, supplier_id: s1, purchase_price: 9000, sell_price: 13000, status: "void", is_void: true }), payment: 13000 },
        { ticket: base({ passenger_name: "Test Passenger 11", carrier: "QR", pnr: "TSTPNR11", route: "DAC-DOH", travel_date: addDays(-15), client_id: c2, supplier_id: s2, purchase_price: 75000, sell_price: 90000, status: "flown", refund_status: "initiated", refund_receivable: 70000, refund_payable: 65000 }), payment: 90000 },
        { ticket: base({ passenger_name: "Test Passenger 12", carrier: "SV", pnr: "TSTPNR12", route: "DAC-JED", travel_date: addDays(-40), client_id: c1, supplier_id: s1, purchase_price: 53000, sell_price: 64000, status: "closed", refund_status: "closed", refund_receivable: 50000, refund_received: 48000, refund_payable: 44000, refund_paid: 44000 }), payment: 64000 },
        { ticket: base({ passenger_name: "Test Passenger 13", carrier: "TK", pnr: "TSTPNR13", route: "DAC-IST", travel_date: addDays(-25), client_id: c2, supplier_id: s2, purchase_price: 82000, sell_price: 99000, status: "reissued" }), payment: 99000 },
      ]

      const { data: firstInserted, error: firstErr } = await supabase
        .from("tickets")
        .insert(firstBatchSpecs.map((s) => s.ticket))
        .select("id, client_id")
      if (firstErr) throw firstErr

      const parentTicket = firstInserted[firstInserted.length - 1]

      const secondBatchSpecs = [
        {
          ticket: base({
            passenger_name: "Test Passenger 14",
            carrier: "TK",
            pnr: "TSTPNR14",
            route: "DAC-IST",
            travel_date: addDays(25),
            client_id: parentTicket.client_id,
            supplier_id: s2,
            purchase_price: 86000,
            sell_price: 104000,
            parent_ticket_id: parentTicket.id,
            is_reissue: true,
            reissue_fee_collected: 6000,
            reissue_fee_paid: 4000,
            fare_difference: 3000,
          }),
          payment: 40000,
        },
        {
          ticket: base({ passenger_name: "Test Passenger 15", carrier: "BS", pnr: "TSTPNR15", route: "DAC-COX", travel_date: addDays(60), client_id: c3, supplier_id: s1, purchase_price: 6000, sell_price: 9000 }),
          payment: null,
        },
      ]

      const { data: secondInserted, error: secondErr } = await supabase
        .from("tickets")
        .insert(secondBatchSpecs.map((s) => s.ticket))
        .select("id, client_id")
      if (secondErr) throw secondErr

      const allInserted = [...firstInserted, ...secondInserted]
      const allSpecs = [...firstBatchSpecs, ...secondBatchSpecs]

      for (let i = 0; i < allInserted.length; i++) {
        const amount = allSpecs[i].payment
        if (!amount) continue
        const row = allInserted[i]
        const { data: payRow } = await supabase
          .from("payments")
          .insert({
            agent_id: agent.id,
            client_id: row.client_id,
            type: "client_payment",
            amount,
            unallocated_amount: amount,
            channel: "bKash",
            trx_id: null,
            notes: "Seed test payment",
            payment_date: todayStr,
          })
          .select("id")
          .single()
        if (payRow) {
          await supabase.from("ticket_payments").insert({
            payment_id: payRow.id,
            ticket_id: row.id,
            allocated_amount: amount,
            type: "client",
          })
        }
      }

      await Promise.all([fetchTickets(), fetchFilterOptions()])
    } catch (err) {
      setError(err.message ?? "Failed to seed test data")
    } finally {
      setSeeding(false)
    }
  }

  const openAdd = () => {
    setEditingTicket(null)
    setModalOpen(true)
  }

  const openEdit = (ticket) => {
    setEditingTicket(ticket)
    setModalOpen(true)
  }

  const handleSaved = (saved) => {
    setTickets((prev) => {
      const exists = prev.find((t) => t.id === saved.id)
      if (exists) return prev.map((t) => (t.id === saved.id ? saved : t))
      return [saved, ...prev]
    })
  }

  const handleDelete = async (id) => {
    setDeleting(true)
    const { error } = await supabase.from("tickets").delete().eq("id", id)
    setDeleting(false)
    if (error) {
      setError(error.message)
    } else {
      setTickets((prev) => prev.filter((t) => t.id !== id))
      setConfirmDeleteId(null)
    }
  }

  const openVoid = (ticket) => setVoidingTicket(ticket)
  const openRefund = (ticket, mode) => setRefundModal({ ticket, mode })
  const openReissue = (ticket) => setReissuingTicket(ticket)
  const openRecordPayment = (ticket) => setRecordPaymentTicket(ticket)
  const openView = (ticket) => setViewingTicket(ticket)

  const handleNavigate = (id) => {
    const target = tickets.find((t) => t.id === id)
    if (target) setViewingTicket(target)
  }

  const handleReissueSaved = ({ parentId, child }) => {
    setTickets((prev) => [
      child,
      ...prev.map((t) => (t.id === parentId ? { ...t, status: "reissued" } : t)),
    ])
  }

  const actionConfig = (action, ticket) => {
    switch (action) {
      case "void":
        return { label: "Void", cls: "text-red-600", onClick: () => openVoid(ticket) }
      case "refund":
        return { label: "Refund", cls: "text-purple-600", onClick: () => openRefund(ticket, "initiate") }
      case "reissue":
        return { label: "Reissue", cls: "text-orange-600", onClick: () => openReissue(ticket) }
      case "record_payment":
        return { label: "Record Payment", cls: "text-green-600", onClick: () => openRecordPayment(ticket) }
      case "record_supplier_refund":
        return { label: "Record Supplier Refund", cls: "text-purple-600", onClick: () => openRefund(ticket, "supplier") }
      case "record_client_refund":
        return { label: "Record Client Refund", cls: "text-purple-600", onClick: () => openRefund(ticket, "client") }
      case "view":
        return { label: "View", cls: "text-gray-600", onClick: () => openView(ticket) }
      default:
        return null
    }
  }

  return (
    <AppLayout
      title="Tickets"
      actions={
        <>
          <button
            onClick={seedTestData}
            disabled={seeding}
            title="Temporary — inserts 15 dummy tickets covering every chip combination for testing"
            className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-600 text-sm font-medium px-4 py-2 rounded-lg border border-gray-200 transition-colors disabled:opacity-60"
          >
            {seeding ? "Seeding…" : "Seed test data"}
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add ticket
          </button>
        </>
      }
    >
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Passenger, PNR, route…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="w-52">
              <label className="block text-xs font-medium text-gray-500 mb-1">Airline</label>
              <SearchableDropdown
                options={AIRLINE_FILTER_OPTIONS}
                value={airlineFilter}
                onChange={setAirlineFilter}
                placeholder="All Airlines"
              />
            </div>
            <div className="w-44">
              <label className="block text-xs font-medium text-gray-500 mb-1">Client</label>
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="w-44">
              <label className="block text-xs font-medium text-gray-500 mb-1">Supplier</label>
              <select
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Suppliers</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="w-36">
              <label className="block text-xs font-medium text-gray-500 mb-1">Issue date from</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="w-36">
              <label className="block text-xs font-medium text-gray-500 mb-1">Issue date to</label>
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

          <div className="flex flex-wrap gap-2 mt-3">
            {STATUS_CHIP_OPTIONS.map((chip) => {
              const active = selectedChips.includes(chip)
              return (
                <button
                  key={chip}
                  onClick={() => toggleChip(chip)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    active
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {chip}
                </button>
              )
            })}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="py-20 text-center text-sm text-gray-400">Loading tickets…</div>
          ) : tickets.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-gray-400 text-sm">No tickets yet.</p>
              <button
                onClick={openAdd}
                className="mt-3 text-blue-600 hover:underline text-sm font-medium"
              >
                Add your first ticket
              </button>
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-gray-400 text-sm">No tickets match the current filters.</p>
              <button
                onClick={clearFilters}
                className="mt-3 text-blue-600 hover:underline text-sm font-medium"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left">
                    <th className="px-4 py-3 font-medium text-gray-500">Issue Date</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Travel Date</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Passenger</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Route</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Carrier</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Client</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Supplier</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Sell</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Purchase</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Margin</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Net</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Paid</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Narration</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Status</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pagedTickets.map((ticket) => {
                    const ticketMargin = (ticket.sell_price ?? 0) - (ticket.purchase_price ?? 0)
                    const netMargin = computeNetMargin(ticket)
                    const narration = ticket.narration
                      ? ticket.narration.length > 30
                        ? ticket.narration.slice(0, 30) + "…"
                        : ticket.narration
                      : null
                    return (
                      <tr key={ticket.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-gray-600">
                          {ticket.issue_date
                            ? new Date(ticket.issue_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {ticket.travel_date
                            ? new Date(ticket.travel_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                            : "—"}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{ticket.passenger_name}</td>
                        <td className="px-4 py-3 text-gray-600 font-mono text-xs">{ticket.route}</td>
                        <td className="px-4 py-3 text-gray-600">{ticket.carrier}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {ticket.clients?.name ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {ticket.suppliers?.name ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-right tabular-nums">
                          {fmt(ticket.sell_price)}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-right tabular-nums">
                          {fmt(ticket.purchase_price)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right tabular-nums font-medium ${
                            ticketMargin >= 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {fmtMargin(ticketMargin)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right tabular-nums font-medium ${
                            netMargin >= 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {fmtMargin(netMargin)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                          {fmt(ticket.amount_paid)}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs max-w-[140px] truncate">
                          {narration ?? <span className="text-gray-200">—</span>}
                        </td>
                        {/* All chips in one cell; allow wrapping */}
                        <td className="px-4 py-3 whitespace-normal min-w-[120px]">
                          <TicketChips ticket={ticket} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {confirmDeleteId === ticket.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-gray-500 text-xs">Delete?</span>
                              <button
                                onClick={() => handleDelete(ticket.id)}
                                disabled={deleting}
                                className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 px-2.5 py-1 rounded-md transition-colors"
                              >
                                {deleting ? "…" : "Yes"}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-xs font-medium text-gray-600 hover:text-gray-800 px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-100 transition-colors"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <div className="flex justify-end">
                              <RowActionsMenu
                                isOpen={openActionMenuId === ticket.id}
                                onToggle={() =>
                                  setOpenActionMenuId((id) => (id === ticket.id ? null : ticket.id))
                                }
                                onClose={() => setOpenActionMenuId(null)}
                                items={[
                                  { key: "edit", label: "Edit", cls: "text-blue-600", onClick: () => openEdit(ticket) },
                                  ...getRowActions(ticket)
                                    .map((action) => {
                                      const config = actionConfig(action, ticket)
                                      return config ? { key: action, ...config } : null
                                    })
                                    .filter(Boolean),
                                  { key: "delete", label: "Delete", cls: "text-red-600", onClick: () => setConfirmDeleteId(ticket.id) },
                                ]}
                              />
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && filteredTickets.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
            <p className="text-xs text-gray-400">
              Showing {showingFrom}-{showingTo} of {filteredTickets.length} ticket
              {filteredTickets.length !== 1 ? "s" : ""}
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

      <TicketModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
        ticket={editingTicket}
      />

      <VoidConfirmModal
        isOpen={!!voidingTicket}
        onClose={() => setVoidingTicket(null)}
        ticket={voidingTicket}
        onSaved={handleSaved}
      />

      <RefundModal
        isOpen={!!refundModal}
        onClose={() => setRefundModal(null)}
        ticket={refundModal?.ticket}
        mode={refundModal?.mode}
        onSaved={handleSaved}
      />

      <ReissueModal
        isOpen={!!reissuingTicket}
        onClose={() => setReissuingTicket(null)}
        ticket={reissuingTicket}
        onSaved={handleReissueSaved}
      />

      <RecordPaymentModal
        isOpen={!!recordPaymentTicket}
        onClose={() => setRecordPaymentTicket(null)}
        ticket={recordPaymentTicket}
        onSaved={handleSaved}
      />

      <TicketDetailModal
        isOpen={!!viewingTicket}
        onClose={() => setViewingTicket(null)}
        ticket={viewingTicket}
        tickets={tickets}
        onNavigate={handleNavigate}
      />
    </AppLayout>
  )
}
