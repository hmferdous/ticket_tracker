import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import ClientModal from "../../components/clients/ClientModal"
import LogPaymentModal from "../../components/clients/LogPaymentModal"
import AllocationModal from "../../components/clients/AllocationModal"
import TicketDetailModal from "../../components/tickets/TicketDetailModal"
import ViewPaymentModal from "../../components/payments/ViewPaymentModal"
import DocumentsTab from "../../components/ui/DocumentsTab"
import AppLayout from "../../components/layout/AppLayout"

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

function Badge({ label, className }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${className}`}>
      {label}
    </span>
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

function paymentStatusBadge(status) {
  if (status === "unpaid") return { label: "Unpaid", cls: "bg-red-100 text-red-700" }
  if (status === "partial") return { label: "Partial", cls: "bg-yellow-100 text-yellow-700" }
  if (status === "paid") return { label: "Paid", cls: "bg-green-100 text-green-700" }
  return null
}

function computeTicketChips(ticket) {
  const today = new Date().toISOString().split("T")[0]
  const chips = []

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
  if (ticket.is_void) chips.push({ label: "Void", cls: "bg-gray-100 text-gray-500" })
  if (ticket.status === "reissued") chips.push({ label: "Reissued", cls: "bg-orange-100 text-orange-700" })
  if (ticket.is_reissue) chips.push({ label: "Reissue", cls: "bg-blue-100 text-blue-700" })
  if (ticket.refund_status === "initiated") chips.push({ label: "Refund", cls: "bg-yellow-100 text-yellow-700" })
  if (ticket.refund_status === "closed") chips.push({ label: "Refunded", cls: "bg-red-100 text-red-700" })

  return chips
}

function RowActionsMenu({ items, isOpen, onToggle, onClose }) {
  if (items.length === 0) return <span className="text-gray-300 text-xs">—</span>
  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={onToggle}
        className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        aria-label="Row actions"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={onClose} />
          <div className="absolute right-0 top-full z-20 mt-1 w-44 bg-white rounded-lg shadow-lg border border-gray-100 py-1">
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

function StatCard({ label, value, accent, action }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-3">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-semibold mt-1 tabular-nums ${accent ?? "text-gray-900"}`}>{fmt(value)}</p>
      {action}
    </div>
  )
}

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { agent } = useAuth()

  const [client, setClient] = useState(null)
  const [tickets, setTickets] = useState([])
  const [payments, setPayments] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [activeTab, setActiveTab] = useState("tickets")
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [viewingTicket, setViewingTicket] = useState(null)
  const [logPaymentOpen, setLogPaymentOpen] = useState(false)
  const [allocationTarget, setAllocationTarget] = useState(null)
  const [openActionMenuId, setOpenActionMenuId] = useState(null)
  const [viewingPayment, setViewingPayment] = useState(null)

  useEffect(() => {
    if (agent?.id && id) fetchAll()
  }, [agent, id])

  const fetchAll = async () => {
    setLoading(true)
    setError("")

    const [
      { data: clientData, error: clientErr },
      { data: ticketData, error: ticketErr },
      { data: paymentData, error: paymentErr },
      { data: supplierData },
    ] = await Promise.all([
      supabase
        .from("clients")
        .select("id, name, phone, email, notes, client_id_number")
        .eq("id", id)
        .eq("agent_id", agent.id)
        .single(),
      supabase
        .from("tickets")
        .select(`
          id, passenger_name, route, pnr, ticket_number, travel_date, return_date, issue_date, carrier, narration,
          purchase_price, sell_price, gds_price,
          amount_paid, payment_status, status, refund_status,
          is_reissue, is_void, parent_ticket_id,
          refund_receivable, refund_received, refund_payable, refund_paid, refund_notes,
          reissue_fee_collected, reissue_fee_paid, fare_difference,
          client_id, supplier_id,
          clients(name), suppliers(name),
          created_at
        `)
        .eq("client_id", id)
        .eq("agent_id", agent.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("payments")
        .select("id, type, amount, unallocated_amount, channel, trx_id, notes, payment_date, created_at, clients(name, client_id_number), ticket_payments(type, tickets(pnr, passenger_name))")
        .eq("client_id", id)
        .eq("agent_id", agent.id)
        .eq("type", "client_payment")
        .order("payment_date", { ascending: false }),
      supabase.from("suppliers").select("id, name").eq("agent_id", agent.id).order("name"),
    ])

    setLoading(false)
    const firstErr = clientErr || ticketErr || paymentErr
    if (firstErr) {
      setError(firstErr.message)
      return
    }
    setClient(clientData)
    setTickets(ticketData ?? [])
    setPayments(paymentData ?? [])
    setSuppliers(supplierData ?? [])
  }

  const totalBilled = useMemo(() => tickets.reduce((sum, t) => sum + (t.sell_price ?? 0), 0), [tickets])
  const totalReceived = useMemo(() => payments.reduce((sum, p) => sum + (p.amount ?? 0), 0), [payments])
  // Void/refund-active tickets don't represent a real collection expectation
  // anymore — sum per-ticket outstanding instead of netting totalBilled
  // against totalReceived, so those tickets can't inflate the balance.
  const outstandingBalance = useMemo(
    () =>
      tickets
        .filter((t) => !t.is_void && t.refund_status == null)
        .reduce((sum, t) => sum + Math.max((t.sell_price ?? 0) - (t.amount_paid ?? 0), 0), 0),
    [tickets]
  )
  const unallocatedCredit = useMemo(() => payments.reduce((sum, p) => sum + (p.unallocated_amount ?? 0), 0), [payments])

  const handleNavigateTicket = (ticketId) => {
    const target = tickets.find((t) => t.id === ticketId)
    if (target) setViewingTicket(target)
  }

  const openAllocate = async (payment) => {
    const { data } = await supabase
      .from("tickets")
      .select(`
        id, passenger_name, route, pnr, ticket_number, travel_date, return_date, issue_date, carrier, narration,
        purchase_price, sell_price, gds_price,
        amount_paid, payment_status, status, refund_status,
        is_reissue, is_void, parent_ticket_id,
        refund_receivable, refund_received, refund_payable, refund_paid, refund_notes,
        reissue_fee_collected, reissue_fee_paid, fare_difference,
        client_id, supplier_id,
        clients(name), suppliers(name),
        created_at
      `)
      .eq("client_id", id)
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })
    setTickets(data ?? [])
    setAllocationTarget(payment)
  }

  const handleLogged = (payment) => {
    openAllocate(payment)
  }

  const handleAllocationClose = () => {
    setAllocationTarget(null)
    fetchAll()
  }

  const handleSettle = () => {
    const oldest = [...payments]
      .filter((p) => (p.unallocated_amount ?? 0) > 0)
      .sort((a, b) => (a.payment_date || a.created_at || "").localeCompare(b.payment_date || b.created_at || ""))[0]
    if (oldest) openAllocate(oldest)
  }

  const handleDeletePayment = async (paymentId) => {
    if (!window.confirm("Delete this payment? This cannot be undone.")) return

    const { data: tps } = await supabase
      .from("ticket_payments")
      .select("id, ticket_id, allocated_amount")
      .eq("payment_id", paymentId)

    for (const tp of tps ?? []) {
      if ((tp.allocated_amount ?? 0) !== 0) {
        const { data: ticket } = await supabase
          .from("tickets")
          .select("amount_paid, sell_price")
          .eq("id", tp.ticket_id)
          .single()
        if (ticket) {
          const newAmountPaid = Math.max(0, (ticket.amount_paid ?? 0) - tp.allocated_amount)
          const newStatus = newAmountPaid <= 0 ? "unpaid" : newAmountPaid >= (ticket.sell_price ?? 0) ? "paid" : "partial"
          await supabase.from("tickets").update({ amount_paid: newAmountPaid, payment_status: newStatus }).eq("id", tp.ticket_id)
        }
      }
    }

    if ((tps ?? []).length > 0) {
      await supabase.from("ticket_payments").delete().eq("payment_id", paymentId)
    }

    const { error } = await supabase.from("payments").delete().eq("id", paymentId)
    if (error) { setError(error.message); return }

    fetchAll()
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  return (
    <AppLayout
      title="Client Details"
      actions={
        client && (
          <>
            <button
              onClick={() => setEditModalOpen(true)}
              className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => navigate(`/reports/client-ledger?clientId=${id}`)}
              className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              View Ledger
            </button>
            <button
              onClick={() => setLogPaymentOpen(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Log Payment
            </button>
          </>
        )
      }
    >
      <div className="max-w-5xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">Loading client…</div>
        ) : !client ? (
          <div className="py-20 text-center text-sm text-gray-400">Client not found.</div>
        ) : (
          <>
            {/* Client details card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 flex items-start gap-4">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-xs font-semibold tracking-wide mt-1.5">
                {clientIdLabel(client.client_id_number)}
              </span>
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">{client.name}</h2>
                <div className="mt-2 flex flex-wrap gap-x-8 gap-y-1 text-sm">
                  <p>
                    <span className="text-gray-400">Phone:</span>{" "}
                    <span className="text-gray-700">{client.phone || "—"}</span>
                  </p>
                  <p>
                    <span className="text-gray-400">Email:</span>{" "}
                    <span className="text-gray-700">{client.email || "—"}</span>
                  </p>
                  <p>
                    <span className="text-gray-400">Notes:</span>{" "}
                    <span className="text-gray-700">{client.notes || "—"}</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <StatCard label="Total Billed" value={totalBilled} />
              <StatCard label="Total Received" value={totalReceived} accent="text-green-600" />
              <StatCard
                label="Outstanding Balance"
                value={outstandingBalance}
                accent={outstandingBalance > 0 ? "text-red-600" : "text-gray-900"}
              />
              <StatCard
                label="Unallocated Credit"
                value={unallocatedCredit}
                accent={unallocatedCredit > 0 ? "text-blue-600" : "text-gray-900"}
                action={
                  unallocatedCredit > 0 && (
                    <button
                      onClick={handleSettle}
                      className="mt-2 px-2.5 py-1 bg-white border border-gray-300 text-gray-700 rounded-md text-xs font-medium hover:bg-gray-50 transition-colors"
                    >
                      Settle
                    </button>
                  )
                }
              />
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-gray-200 mb-4">
              {[
                { key: "tickets", label: "Tickets" },
                { key: "payments", label: "Payment History" },
                { key: "documents", label: "Documents" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    activeTab === tab.key
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tickets tab */}
            {activeTab === "tickets" && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
                {tickets.length === 0 ? (
                  <div className="py-16 text-center text-sm text-gray-400">
                    No tickets assigned to this client. If you added tickets from the Tickets page, make sure the Client field was set to this client when creating them.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-left">
                        <th className="px-4 py-3 font-medium text-gray-500">Passenger</th>
                        <th className="px-4 py-3 font-medium text-gray-500">Ticket No</th>
                        <th className="px-4 py-3 font-medium text-gray-500">PNR</th>
                        <th className="px-4 py-3 font-medium text-gray-500">Issue Date</th>
                        <th className="px-4 py-3 font-medium text-gray-500">Route</th>
                        <th className="px-4 py-3 font-medium text-gray-500">Travel Date</th>
                        <th className="px-4 py-3 font-medium text-gray-500">Carrier</th>
                        <th className="px-4 py-3 font-medium text-gray-500 text-right">Sell Price</th>
                        <th className="px-4 py-3 font-medium text-gray-500 text-right">Amount Paid</th>
                        <th className="px-4 py-3 font-medium text-gray-500 text-right">Outstanding</th>
                        <th className="px-4 py-3 font-medium text-gray-500">Status</th>
                        <th className="px-4 py-3 font-medium text-gray-500">Chips</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {tickets.map((ticket) => {
                        const outstanding = !ticket.is_void && ticket.refund_status == null
                          ? (ticket.sell_price ?? 0) - (ticket.amount_paid ?? 0)
                          : 0
                        const statusBadge = paymentStatusBadge(ticket.payment_status)
                        const chips = computeTicketChips(ticket)
                        return (
                          <tr
                            key={ticket.id}
                            onClick={() => setViewingTicket(ticket)}
                            className="hover:bg-gray-50 transition-colors cursor-pointer"
                          >
                            <td className="px-4 py-3 font-medium text-gray-900">{ticket.passenger_name}</td>
                            <td className="px-4 py-3">
                              {ticket.ticket_number
                                ? <span className="font-mono text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{ticket.ticket_number}</span>
                                : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              {ticket.pnr
                                ? <span className="font-mono text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{ticket.pnr.toUpperCase()}</span>
                                : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                            <td className="px-4 py-3 text-gray-600">{fmtDate(ticket.issue_date)}</td>
                            <td className="px-4 py-3 text-gray-600">{ticket.route ?? "—"}</td>
                            <td className="px-4 py-3 text-gray-600">{fmtDate(ticket.travel_date)}</td>
                            <td className="px-4 py-3 text-gray-600">{ticket.carrier ?? "—"}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmt(ticket.sell_price)}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-600">{fmt(ticket.amount_paid)}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-600">{fmt(outstanding)}</td>
                            <td className="px-4 py-3">
                              {statusBadge ? <Badge label={statusBadge.label} className={statusBadge.cls} /> : "—"}
                            </td>
                            <td className="px-4 py-3 whitespace-normal min-w-[140px]">
                              {chips.length === 0 ? (
                                <span className="text-gray-300 text-xs">—</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {chips.map((chip, i) => (
                                    <Badge key={i} label={chip.label} className={chip.cls} />
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Payment history tab */}
            {activeTab === "payments" && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {payments.length === 0 ? (
                  <div className="py-16 text-center text-sm text-gray-400">No payments logged for this client yet.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-left">
                        <th className="px-4 py-3 font-medium text-gray-500">Date</th>
                        <th className="px-4 py-3 font-medium text-gray-500 text-right">Amount</th>
                        <th className="px-4 py-3 font-medium text-gray-500">Ticket</th>
                        <th className="px-4 py-3 font-medium text-gray-500">Channel</th>
                        <th className="px-4 py-3 font-medium text-gray-500">Trx ID</th>
                        <th className="px-4 py-3 font-medium text-gray-500 text-right">Unallocated</th>
                        <th className="px-4 py-3 font-medium text-gray-500">Notes</th>
                        <th className="px-4 py-3 font-medium text-gray-500 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {payments.map((payment) => (
                        <tr key={payment.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-gray-600">{fmtDate(payment.payment_date)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmt(payment.amount)}</td>
                          <td className="px-4 py-3"><TicketTagCell payment={payment} /></td>
                          <td className="px-4 py-3 text-gray-600">{payment.channel ?? "—"}</td>
                          <td className="px-4 py-3 text-gray-600">{payment.trx_id ?? "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-600">{fmt(payment.unallocated_amount)}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs max-w-[180px] truncate">
                            {payment.notes ?? <span className="text-gray-200">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <RowActionsMenu
                              isOpen={openActionMenuId === payment.id}
                              onToggle={() => setOpenActionMenuId((prev) => (prev === payment.id ? null : payment.id))}
                              onClose={() => setOpenActionMenuId(null)}
                              items={[
                                { key: "view", label: "View / Edit", cls: "text-gray-600", onClick: () => setViewingPayment(payment) },
                                ...((payment.unallocated_amount ?? 0) > 0
                                  ? [{ key: "allocate", label: "Allocate", cls: "text-blue-600", onClick: () => openAllocate(payment) }]
                                  : []),
                                { key: "delete", label: "Delete", cls: "text-red-500", onClick: () => handleDeletePayment(payment.id) },
                              ]}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Documents tab */}
            {activeTab === "documents" && (
              <DocumentsTab entityType="client" entityId={id} agentId={agent?.id} />
            )}

          </>
        )}
      </div>

      <ClientModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        onSaved={(saved) => setClient(saved)}
        client={client}
      />

      <TicketDetailModal
        isOpen={!!viewingTicket}
        onClose={() => { setViewingTicket(null); fetchAll() }}
        ticket={viewingTicket}
        tickets={tickets}
        onNavigate={handleNavigateTicket}
      />

      <ViewPaymentModal
        isOpen={!!viewingPayment}
        onClose={() => setViewingPayment(null)}
        payment={viewingPayment}
        onSaved={fetchAll}
      />

      <LogPaymentModal
        isOpen={logPaymentOpen}
        onClose={() => setLogPaymentOpen(false)}
        client={client}
        onLogged={handleLogged}
      />

      <AllocationModal
        isOpen={!!allocationTarget}
        onClose={handleAllocationClose}
        payment={allocationTarget}
        clientName={client?.name}
        tickets={tickets}
        onAllocated={fetchAll}
      />
    </AppLayout>
  )
}
