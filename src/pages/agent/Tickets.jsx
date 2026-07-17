import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import TicketModal from "../../components/tickets/TicketModal"
import VoidConfirmModal from "../../components/tickets/VoidConfirmModal"
import RefundModal from "../../components/tickets/RefundModal"
import ReissueModal from "../../components/tickets/ReissueModal"
import EditReissueModal from "../../components/tickets/EditReissueModal"
import RecordPaymentModal from "../../components/tickets/RecordPaymentModal"
import AllocationModal from "../../components/clients/AllocationModal"
import TicketDetailModal from "../../components/tickets/TicketDetailModal"
import AppLayout from "../../components/layout/AppLayout"
import { AIRLINES } from "../../lib/airlines"
import { clientOutstanding } from "../../lib/refunds"

// Row-level actions available for a ticket, based on its current state
function getRowActions(ticket) {
  const notVoid = ticket.status !== "void"
  const notReissued = ticket.status !== "reissued"
  const actions = []

  if (notVoid && notReissued && ticket.refund_status !== "closed") actions.push("void")
  if (notVoid && notReissued && ticket.refund_status === null) actions.push("refund")
  if (notVoid && notReissued && ticket.refund_status !== "initiated") actions.push("reissue")
  if (ticket.payment_status !== "paid" && notVoid) actions.push("record_payment")
  if (ticket.is_reissue && notVoid) actions.push("edit_reissue_details")

  // Both sides settle independently and can take multiple installments —
  // no ordering dependency, and stays available (to add more) until closed.
  if (ticket.refund_status && ticket.refund_status !== "closed") {
    actions.push("record_supplier_refund")
    actions.push("record_client_refund")
  }
  if (ticket.refund_status) {
    actions.push("edit_refund_terms")
    if (ticket.refund_received != null) actions.push("edit_supplier_refund_received")
    if (ticket.refund_paid != null) actions.push("edit_client_refund_paid")
    actions.push("cancel_refund")
  }

  actions.push("view")
  return actions
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200]

const STATUS_CHIP_OPTIONS = [
  "Unpaid",
  "Partial",
  "Paid",
  "Upcoming",
  "Flying tomorrow",
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
  const tomorrowDate = new Date()
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const tomorrow = tomorrowDate.toISOString().split("T")[0]
  const chips = []

  // Payment chips
  if (ticket.payment_status === "unpaid") {
    chips.push({ label: "Unpaid", cls: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" })
  } else if (ticket.payment_status === "partial") {
    chips.push({ label: "Partial", cls: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400" })
  } else if (ticket.payment_status === "paid") {
    chips.push({ label: "Paid", cls: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" })
  }

  // Flight chips — based on travel_date and return_date
  if (ticket.travel_date) {
    if (ticket.travel_date === today) {
      chips.push({ label: "Flying today", cls: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400" })
    } else if (ticket.travel_date === tomorrow) {
      chips.push({ label: "Flying tomorrow", cls: "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400" })
    } else if (ticket.travel_date > today) {
      chips.push({ label: "Upcoming", cls: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400" })
    } else if (ticket.return_date && ticket.return_date >= today) {
      chips.push({ label: "Return pending", cls: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400" })
    } else {
      chips.push({ label: "Flown", cls: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400" })
    }
  }

  // Lifecycle chips
  if (ticket.is_void) {
    chips.push({ label: "Void", cls: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400" })
  }
  if (ticket.status === "reissued") {
    chips.push({ label: "Reissued", cls: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400" })
  }
  if (ticket.is_reissue) {
    chips.push({ label: "Reissue", cls: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400" })
  }
  if (ticket.refund_status != null && ticket.refund_status !== "closed") {
    chips.push({ label: "Refund", cls: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400" })
  }
  if (ticket.refund_status === "closed") {
    chips.push({ label: "Refunded", cls: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" })
  }

  return chips
}

function TicketChips({ ticket }) {
  const chips = computeChips(ticket)
  if (chips.length === 0) return <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((chip, i) => (
        <Badge key={i} label={chip.label} className={chip.cls} />
      ))}
    </div>
  )
}

function MultiSelectDropdown({ options, selected, onChange, placeholder }) {
  const btnRef = useRef(null)
  const menuRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 })

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 220) })
    }
    setOpen((v) => !v)
  }

  useEffect(() => {
    if (!open) return
    const onScroll = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return
      setOpen(false)
    }
    const onResize = () => setOpen(false)
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onResize)
    }
  }, [open])

  const toggle = (value) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
      ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
      : `${selected.length} selected`

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        className={`w-full flex items-center justify-between px-3 py-2 border rounded-lg text-sm text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
          selected.length > 0
            ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
            : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:border-gray-400"
        }`}
      >
        <span className="truncate">{label}</span>
        <svg className="w-3.5 h-3.5 ml-2 shrink-0 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            ref={menuRef}
            className="fixed z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl py-1 overflow-auto max-h-64"
            style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
          >
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => { onChange([]); setOpen(false) }}
                className="flex w-full items-center px-4 py-2 text-xs text-red-500 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-100 dark:border-gray-800"
              >
                Clear selection
              </button>
            )}
            {options.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt.value)}
                  onChange={() => toggle(opt.value)}
                  className="rounded border-gray-300 dark:border-gray-700 text-blue-600 dark:text-blue-400 focus:ring-blue-500"
                />
                <span className="text-gray-700 dark:text-gray-300">{opt.label}</span>
              </label>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

function RowActionsMenu({ items, isOpen, onToggle, onClose }) {
  const btnRef = useRef(null)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })

  const handleToggle = () => {
    if (!isOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const menuHeight = items.length * 36 + 8
      setMenuPos({
        top: spaceBelow >= menuHeight ? rect.bottom + 4 : rect.top - menuHeight - 4,
        right: window.innerWidth - rect.right,
      })
    }
    onToggle()
  }

  useEffect(() => {
    if (!isOpen) return
    const close = () => onClose()
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => {
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [isOpen, onClose])

  return (
    <div className="inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-label="Row actions"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>
      {isOpen && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <div
            className="fixed z-50 w-48 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 py-1 overflow-hidden"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => { onClose(); item.onClick() }}
                className={`flex w-full items-center text-left px-4 py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${item.cls}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>,
        document.body
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
  // Booked/agreed basis, matching ticket_margin's own accrual nature — uses
  // refund_receivable (what the supplier agreed to) rather than refund_received
  // (what's actually landed so far), so this reflects the deal's true
  // economics instead of fluctuating with how far collection has progressed.
  const refundMargin = (ticket.refund_receivable ?? 0) - (ticket.refund_payable ?? 0)
  const voidFeeMargin = (ticket.void_fee_collected ?? 0) - (ticket.void_fee_paid ?? 0)
  return ticketMargin + refundMargin + voidFeeMargin
}

export default function Tickets() {
  const { agent } = useAuth()

  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTicket, setEditingTicket] = useState(null)
  const [cloneMode, setCloneMode] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [compact, setCompact] = useState(true)

  // Row-level action modals
  const [voidingTicket, setVoidingTicket] = useState(null)
  const [refundModal, setRefundModal] = useState(null) // { ticket, mode: 'initiate' | 'supplier' | 'client' }
  const [reissuingTicket, setReissuingTicket] = useState(null)
  const [reissueEditTicket, setReissueEditTicket] = useState(null)
  const [recordPaymentTicket, setRecordPaymentTicket] = useState(null)
  const [allocationTarget, setAllocationTarget] = useState(null) // { payment, tickets, clientName }
  const [viewingTicket, setViewingTicket] = useState(null)
  const [openActionMenuId, setOpenActionMenuId] = useState(null)

  // Filter state
  const [searchText, setSearchText] = useState("")
  const [airlineFilters, setAirlineFilters] = useState([])
  const [clientFilters, setClientFilters] = useState([])
  const [supplierFilters, setSupplierFilters] = useState([])
  const [selectedChips, setSelectedChips] = useState([])
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  // Pagination state
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  useEffect(() => {
    if (agent?.id) fetchTickets()
  }, [agent])

  // Reset to page 1 whenever any filter changes
  useEffect(() => {
    setPage(1)
  }, [searchText, airlineFilters, clientFilters, supplierFilters, selectedChips, dateFrom, dateTo])

  const fetchTickets = async () => {
    setLoading(true)
    setError("")
    const { data, error } = await supabase
      .from("tickets")
      .select(`
        id, passenger_name, route, pnr, ticket_number, travel_date, return_date, issue_date, carrier, narration,
        purchase_price, gds_price, sell_price,
        amount_paid, payment_status, status, refund_status,
        is_reissue, is_void, parent_ticket_id,
        refund_receivable, refund_received, refund_payable, refund_paid, refund_notes,
        reissue_fee_collected, reissue_fee_paid, fare_difference,
        void_fee_collected, void_fee_paid,
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

  const toggleChip = (chip) => {
    setSelectedChips((prev) =>
      prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip]
    )
  }

  const clearFilters = () => {
    setSearchText("")
    setAirlineFilters([])
    setClientFilters([])
    setSupplierFilters([])
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
      if (airlineFilters.length > 0 && !airlineFilters.includes(ticket.carrier)) return false
      if (clientFilters.length > 0) {
        const match = (clientFilters.includes("__blank__") && !ticket.client_id) ||
                      (ticket.client_id && clientFilters.includes(ticket.client_id))
        if (!match) return false
      }
      if (supplierFilters.length > 0) {
        const match = (supplierFilters.includes("__blank__") && !ticket.supplier_id) ||
                      (ticket.supplier_id && supplierFilters.includes(ticket.supplier_id))
        if (!match) return false
      }
      if (dateFrom && (!ticket.issue_date || ticket.issue_date < dateFrom)) return false
      if (dateTo && (!ticket.issue_date || ticket.issue_date > dateTo)) return false
      if (selectedChips.length > 0) {
        const labels = computeChips(ticket).map((c) => c.label)
        if (!selectedChips.some((chip) => labels.includes(chip))) return false
      }
      return true
    })
  }, [tickets, searchText, airlineFilters, clientFilters, supplierFilters, dateFrom, dateTo, selectedChips])

  const airlineOptions = useMemo(() => {
    const seen = new Set()
    const opts = []
    for (const t of tickets) {
      if (t.carrier && !seen.has(t.carrier)) {
        seen.add(t.carrier)
        const name = AIRLINES.find((a) => a.code === t.carrier)?.name
        opts.push({ value: t.carrier, label: name ? `${t.carrier} — ${name}` : t.carrier })
      }
    }
    return opts.sort((a, b) => a.value.localeCompare(b.value))
  }, [tickets])

  const clientOptions = useMemo(() => {
    const seen = new Map()
    let hasBlank = false
    for (const t of tickets) {
      if (!t.client_id) hasBlank = true
      else if (t.clients?.name && !seen.has(t.client_id)) seen.set(t.client_id, t.clients.name)
    }
    const opts = [...seen.entries()]
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label))
    if (hasBlank) opts.unshift({ value: "__blank__", label: "Blank" })
    return opts
  }, [tickets])

  const supplierOptions = useMemo(() => {
    const seen = new Map()
    let hasBlank = false
    for (const t of tickets) {
      if (!t.supplier_id) hasBlank = true
      else if (t.suppliers?.name && !seen.has(t.supplier_id)) seen.set(t.supplier_id, t.suppliers.name)
    }
    const opts = [...seen.entries()]
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label))
    if (hasBlank) opts.unshift({ value: "__blank__", label: "Blank" })
    return opts
  }, [tickets])

  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const startIdx = (safePage - 1) * pageSize
  const pagedTickets = filteredTickets.slice(startIdx, startIdx + pageSize)
  const showingFrom = filteredTickets.length === 0 ? 0 : startIdx + 1
  const showingTo = Math.min(startIdx + pageSize, filteredTickets.length)

  const openAdd = () => {
    setEditingTicket(null)
    setCloneMode(false)
    setModalOpen(true)
  }

  const openEdit = (ticket) => {
    setEditingTicket(ticket)
    setCloneMode(false)
    setModalOpen(true)
  }

  // Clone: seed the "add ticket" form with only ticket-identity/flight/pricing
  // fields from the source ticket — no id (so it inserts a new row), and no
  // payment/status/refund fields, matching a genuinely fresh booking.
  const openClone = (ticket) => {
    setEditingTicket({
      passenger_name: ticket.passenger_name,
      carrier: ticket.carrier,
      ticket_number: ticket.ticket_number,
      pnr: ticket.pnr,
      route: ticket.route,
      issue_date: ticket.issue_date,
      travel_date: ticket.travel_date,
      return_date: ticket.return_date,
      client_id: ticket.client_id,
      supplier_id: ticket.supplier_id,
      purchase_price: ticket.purchase_price,
      gds_price: ticket.gds_price,
      sell_price: ticket.sell_price,
      narration: ticket.narration,
    })
    setCloneMode(true)
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

  const openAllocateForClient = async (payment, clientId, clientName) => {
    const { data } = await supabase
      .from("tickets")
      .select(
        "id, passenger_name, route, travel_date, issue_date, sell_price, amount_paid, payment_status, created_at, " +
          "refund_status, refund_receivable, refund_received, refund_payable, refund_paid"
      )
      .eq("client_id", clientId)
      .eq("agent_id", agent.id)
    setAllocationTarget({ payment, tickets: data ?? [], clientName })
  }

  const handleRecordPaymentSaved = (updatedTicket, payment) => {
    handleSaved(updatedTicket)
    if ((payment?.unallocated_amount ?? 0) > 0) {
      openAllocateForClient(payment, updatedTicket.client_id, updatedTicket.clients?.name)
    }
  }

  const handleAllocationClose = () => {
    setAllocationTarget(null)
    fetchTickets()
  }

  const handleCancelRefund = async (ticket) => {
    setError("")

    // Only safe to fully wipe the refund if nothing real has actually moved
    // yet — a blunt "Edit Refund Received/Paid" override doesn't count (no
    // payment behind it), but a real supplier_refund/client_refund payment
    // does, and cancelling out from under it would leave that payment
    // orphaned with no corresponding refund on the ticket.
    const [{ data: standalone }, { data: allocated }] = await Promise.all([
      supabase.from("payments").select("id").eq("ticket_id", ticket.id).eq("type", "supplier_refund"),
      supabase.from("ticket_payments").select("id").eq("ticket_id", ticket.id).in("type", ["client_refund", "supplier_refund"]),
    ])
    if ((standalone?.length ?? 0) > 0 || (allocated?.length ?? 0) > 0) {
      setError("This refund has real payments recorded against it — delete those first (from the ticket's payment history or the Payments page), then cancel the refund.")
      return
    }

    if (!window.confirm("Cancel this refund? This clears the refund terms and returns the ticket to normal.")) return

    const { data, error } = await supabase
      .from("tickets")
      .update({
        refund_status: null,
        refund_receivable: null,
        refund_received: null,
        refund_payable: null,
        refund_paid: null,
        refund_notes: null,
      })
      .eq("id", ticket.id)
      .select(`*, clients(name), suppliers(name)`)
      .single()

    if (error) { setError(error.message); return }
    handleSaved(data)
  }

  const openVoid = (ticket) => setVoidingTicket(ticket)
  const openRefund = (ticket, mode) => setRefundModal({ ticket, mode })
  const openReissue = (ticket) => setReissuingTicket(ticket)
  const openReissueEdit = (ticket) => setReissueEditTicket(ticket)
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
        return { label: "Void", cls: "text-red-600 dark:text-red-400", onClick: () => openVoid(ticket) }
      case "refund":
        return { label: "Refund", cls: "text-purple-600 dark:text-purple-400", onClick: () => openRefund(ticket, "initiate") }
      case "reissue":
        return { label: "Reissue", cls: "text-orange-600 dark:text-orange-400", onClick: () => openReissue(ticket) }
      case "edit_reissue_details":
        return { label: "Edit Reissue Details", cls: "text-orange-600 dark:text-orange-400", onClick: () => openReissueEdit(ticket) }
      case "record_payment":
        return { label: "Record Payment", cls: "text-green-600 dark:text-green-400", onClick: () => openRecordPayment(ticket) }
      case "record_supplier_refund":
        return {
          label: (ticket.refund_received ?? 0) > 0 ? "Add Supplier Refund Receipt" : "Record Supplier Refund",
          cls: "text-purple-600 dark:text-purple-400",
          onClick: () => openRefund(ticket, "supplier"),
        }
      case "record_client_refund":
        return {
          label: (ticket.refund_paid ?? 0) > 0 ? "Add Client Refund Payment" : "Record Client Refund",
          cls: "text-purple-600 dark:text-purple-400",
          onClick: () => openRefund(ticket, "client"),
        }
      case "edit_refund_terms":
        return { label: "Edit Refund Terms", cls: "text-purple-600 dark:text-purple-400", onClick: () => openRefund(ticket, "edit") }
      case "edit_supplier_refund_received":
        return { label: "Edit Refund Received", cls: "text-purple-600 dark:text-purple-400", onClick: () => openRefund(ticket, "edit_supplier_actual") }
      case "edit_client_refund_paid":
        return { label: "Edit Refund Paid", cls: "text-purple-600 dark:text-purple-400", onClick: () => openRefund(ticket, "edit_client_actual") }
      case "cancel_refund":
        return { label: "Cancel Refund", cls: "text-red-600 dark:text-red-400", onClick: () => handleCancelRefund(ticket) }
      case "view":
        return { label: "View", cls: "text-gray-600 dark:text-gray-400", onClick: () => openView(ticket) }
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
            onClick={() => setCompact((v) => !v)}
            className="flex items-center gap-2 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 text-sm font-medium px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 transition-colors"
            title={compact ? "Switch to detailed view" : "Switch to compact view"}
          >
            {compact ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                Detailed
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
                Compact
              </>
            )}
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
          <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Search</label>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Passenger, PNR, route…"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="w-52">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Airline</label>
              <MultiSelectDropdown
                options={airlineOptions}
                selected={airlineFilters}
                onChange={setAirlineFilters}
                placeholder="All Airlines"
              />
            </div>
            <div className="w-44">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Client</label>
              <MultiSelectDropdown
                options={clientOptions}
                selected={clientFilters}
                onChange={setClientFilters}
                placeholder="All Clients"
              />
            </div>
            <div className="w-44">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Supplier</label>
              <MultiSelectDropdown
                options={supplierOptions}
                selected={supplierFilters}
                onChange={setSupplierFilters}
                placeholder="All Suppliers"
              />
            </div>
            <div className="w-36">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Issue date from</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="w-36">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Issue date to</label>
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
                      : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  {chip}
                </button>
              )
            })}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="py-20 text-center text-sm text-gray-400 dark:text-gray-500">Loading tickets…</div>
          ) : tickets.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-gray-400 dark:text-gray-500 text-sm">No tickets yet.</p>
              <button
                onClick={openAdd}
                className="mt-3 text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium"
              >
                Add your first ticket
              </button>
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-gray-400 dark:text-gray-500 text-sm">No tickets match the current filters.</p>
              <button
                onClick={clearFilters}
                className="mt-3 text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium"
              >
                Clear filters
              </button>
            </div>
          ) : compact ? (
            /* ── Compact table ── */
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 text-left">
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Issue Date</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Flight Date</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">PNR</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Ticket No.</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Route</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Passenger</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Client</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Sell</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Outstanding</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Status</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {pagedTickets.map((ticket) => {
                    const outstanding = !ticket.is_void ? clientOutstanding(ticket) : 0
                    const fmtDate = (d) => d
                      ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                      : <span className="text-gray-300 dark:text-gray-600">—</span>
                    return (
                      <tr key={ticket.id} className="hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors">
                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{fmtDate(ticket.issue_date)}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{fmtDate(ticket.travel_date)}</td>
                        <td className="px-4 py-3"><span className="font-mono text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded">{ticket.pnr?.toUpperCase() || "—"}</span></td>
                        <td className="px-4 py-3"><span className="font-mono text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded">{ticket.ticket_number || "—"}</span></td>
                        <td className="px-4 py-3"><span className="font-mono text-xs text-gray-500 dark:text-gray-400">{ticket.route || "—"}</span></td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{ticket.passenger_name}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{ticket.clients?.name ?? <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums font-medium text-gray-700 dark:text-gray-300">{fmt(ticket.sell_price)}</td>
                        <td className={`px-4 py-3 text-sm text-right tabular-nums font-semibold ${outstanding > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                          {outstanding > 0 ? fmt(outstanding) : "—"}
                        </td>
                        <td className="px-4 py-3 whitespace-normal min-w-[100px]">
                          <TicketChips ticket={ticket} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {confirmDeleteId === ticket.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-gray-500 dark:text-gray-400 text-xs">Delete?</span>
                              <button onClick={() => handleDelete(ticket.id)} disabled={deleting} className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 px-2.5 py-1 rounded-md transition-colors">
                                {deleting ? "…" : "Yes"}
                              </button>
                              <button onClick={() => setConfirmDeleteId(null)} className="text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                No
                              </button>
                            </div>
                          ) : (
                            <div className="flex justify-end">
                              <RowActionsMenu
                                isOpen={openActionMenuId === ticket.id}
                                onToggle={() => setOpenActionMenuId((id) => (id === ticket.id ? null : ticket.id))}
                                onClose={() => setOpenActionMenuId(null)}
                                items={[
                                  { key: "edit", label: "Edit", cls: "text-blue-600 dark:text-blue-400", onClick: () => openEdit(ticket) },
                                  { key: "clone", label: "Clone", cls: "text-gray-700 dark:text-gray-300", onClick: () => openClone(ticket) },
                                  ...getRowActions(ticket).map((action) => { const config = actionConfig(action, ticket); return config ? { key: action, ...config } : null }).filter(Boolean),
                                  { key: "delete", label: "Delete", cls: "text-red-600 dark:text-red-400", onClick: () => setConfirmDeleteId(ticket.id) },
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
          ) : (
            /* ── Detailed table ── */
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 text-left">
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Issue Date</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Travel Date</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">PNR</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Ticket No.</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Passenger</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Route</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Carrier</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Client</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Supplier</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Sell</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Purchase</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Margin</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Net</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Paid</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Outstanding</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Narration</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Status</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {pagedTickets.map((ticket) => {
                    const ticketMargin = (ticket.sell_price ?? 0) - (ticket.purchase_price ?? 0)
                    const netMargin = computeNetMargin(ticket)
                    const narration = ticket.narration
                      ? ticket.narration.length > 30
                        ? ticket.narration.slice(0, 30) + "…"
                        : ticket.narration
                      : null
                    const fmtD = (d) => d
                      ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                      : <span className="text-gray-300 dark:text-gray-600">—</span>
                    const detailOutstanding = !ticket.is_void ? clientOutstanding(ticket) : 0
                    return (
                      <tr key={ticket.id} className="hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors">
                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{fmtD(ticket.issue_date)}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{fmtD(ticket.travel_date)}</td>
                        <td className="px-4 py-3"><span className="font-mono text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded">{ticket.pnr?.toUpperCase() || "—"}</span></td>
                        <td className="px-4 py-3"><span className="font-mono text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded">{ticket.ticket_number || "—"}</span></td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{ticket.passenger_name}</td>
                        <td className="px-4 py-3"><span className="font-mono text-xs text-gray-500 dark:text-gray-400">{ticket.route || "—"}</span></td>
                        <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{ticket.carrier || <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{ticket.clients?.name ?? <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{ticket.suppliers?.name ?? <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums font-medium text-gray-700 dark:text-gray-300">{fmt(ticket.sell_price)}</td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-500 dark:text-gray-400">{fmt(ticket.purchase_price)}</td>
                        <td className={`px-4 py-3 text-sm text-right tabular-nums font-semibold ${ticketMargin >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {fmtMargin(ticketMargin)}
                        </td>
                        <td className={`px-4 py-3 text-sm text-right tabular-nums font-semibold ${netMargin >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {fmtMargin(netMargin)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-600 dark:text-gray-400">{fmt(ticket.amount_paid)}</td>
                        <td className={`px-4 py-3 text-sm text-right tabular-nums font-semibold ${detailOutstanding > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                          {detailOutstanding > 0 ? fmt(detailOutstanding) : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500 max-w-[140px] truncate">
                          {narration ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-normal min-w-[120px]">
                          <TicketChips ticket={ticket} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {confirmDeleteId === ticket.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-gray-500 dark:text-gray-400 text-xs">Delete?</span>
                              <button
                                onClick={() => handleDelete(ticket.id)}
                                disabled={deleting}
                                className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 px-2.5 py-1 rounded-md transition-colors"
                              >
                                {deleting ? "…" : "Yes"}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
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
                                  { key: "edit", label: "Edit", cls: "text-blue-600 dark:text-blue-400", onClick: () => openEdit(ticket) },
                                  { key: "clone", label: "Clone", cls: "text-gray-700 dark:text-gray-300", onClick: () => openClone(ticket) },
                                  ...getRowActions(ticket)
                                    .map((action) => {
                                      const config = actionConfig(action, ticket)
                                      return config ? { key: action, ...config } : null
                                    })
                                    .filter(Boolean),
                                  { key: "delete", label: "Delete", cls: "text-red-600 dark:text-red-400", onClick: () => setConfirmDeleteId(ticket.id) },
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
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Showing {showingFrom}-{showingTo} of {filteredTickets.length} ticket
              {filteredTickets.length !== 1 ? "s" : ""}
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

      <TicketModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
        ticket={editingTicket}
        cloneMode={cloneMode}
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

      <EditReissueModal
        isOpen={!!reissueEditTicket}
        onClose={() => setReissueEditTicket(null)}
        ticket={reissueEditTicket}
        onSaved={handleSaved}
      />

      <RecordPaymentModal
        isOpen={!!recordPaymentTicket}
        onClose={() => setRecordPaymentTicket(null)}
        ticket={recordPaymentTicket}
        onSaved={handleRecordPaymentSaved}
      />

      <AllocationModal
        isOpen={!!allocationTarget}
        onClose={handleAllocationClose}
        payment={allocationTarget?.payment}
        clientName={allocationTarget?.clientName}
        tickets={allocationTarget?.tickets ?? []}
        onAllocated={handleAllocationClose}
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
