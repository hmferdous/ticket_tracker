import { useEffect, useMemo, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import ClientModal from "../../components/clients/ClientModal"
import LogPaymentModal from "../../components/clients/LogPaymentModal"
import AllocationModal from "../../components/clients/AllocationModal"
import TicketDetailModal from "../../components/tickets/TicketDetailModal"

function fmt(n) {
  if (n == null) return "—"
  return Number(n).toLocaleString("en-BD")
}

function fmtDate(d) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function Badge({ label, className }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${className}`}>
      {label}
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

function StatCard({ label, value, accent }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-semibold mt-1 tabular-nums ${accent ?? "text-gray-900"}`}>{fmt(value)}</p>
    </div>
  )
}

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { agent, user, signOut } = useAuth()

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

  useEffect(() => {
    if (agent?.id && id) fetchAll()
  }, [agent, id])

  const fetchAll = async () => {
    setLoading(true)
    setError("")

    const [{ data: clientData, error: clientErr }, { data: ticketData }, { data: paymentData }, { data: supplierData }] =
      await Promise.all([
        supabase.from("clients").select("id, name, phone, email, notes").eq("id", id).eq("agent_id", agent.id).single(),
        supabase
          .from("tickets")
          .select(`
            id, passenger_name, route, pnr, travel_date, return_date, issue_date, carrier, narration,
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
          .select("id, amount, unallocated_amount, channel, trx_id, notes, payment_date, created_at")
          .eq("client_id", id)
          .eq("agent_id", agent.id)
          .eq("type", "client_payment")
          .order("payment_date", { ascending: false }),
        supabase.from("suppliers").select("id, name").eq("agent_id", agent.id).order("name"),
      ])

    setLoading(false)
    if (clientErr) {
      setError(clientErr.message)
      return
    }
    setClient(clientData)
    setTickets(ticketData ?? [])
    setPayments(paymentData ?? [])
    setSuppliers(supplierData ?? [])
  }

  const handleLogout = async () => {
    await signOut()
    navigate("/login")
  }

  const totalBilled = useMemo(() => tickets.reduce((sum, t) => sum + (t.sell_price ?? 0), 0), [tickets])
  const totalReceived = useMemo(() => payments.reduce((sum, p) => sum + (p.amount ?? 0), 0), [payments])
  const outstandingBalance = totalBilled - totalReceived
  const unallocatedCredit = useMemo(() => payments.reduce((sum, p) => sum + (p.unallocated_amount ?? 0), 0), [payments])

  const handleNavigateTicket = (ticketId) => {
    const target = tickets.find((t) => t.id === ticketId)
    if (target) setViewingTicket(target)
  }

  const handleLogged = (payment) => {
    setAllocationTarget(payment)
  }

  const handleSettle = () => {
    const oldest = [...payments]
      .filter((p) => (p.unallocated_amount ?? 0) > 0)
      .sort((a, b) => (a.payment_date || a.created_at || "").localeCompare(b.payment_date || b.created_at || ""))[0]
    if (oldest) setAllocationTarget(oldest)
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/clients")}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Back to clients"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-gray-900">{client?.name ?? "Client"}</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user?.email}</span>
          <button onClick={handleLogout} className="text-sm text-red-600 hover:text-red-700 font-medium transition-colors">
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">Loading client…</div>
        ) : !client ? (
          <div className="py-20 text-center text-sm text-gray-400">Client not found.</div>
        ) : (
          <>
            {/* Summary card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">{client.name}</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {client.phone || <span className="text-gray-300">No phone</span>}
                    {" · "}
                    {client.email || <span className="text-gray-300">No email</span>}
                  </p>
                  {client.notes && <p className="text-sm text-gray-600 mt-2 max-w-2xl">{client.notes}</p>}
                </div>
                <button
                  onClick={() => setEditModalOpen(true)}
                  className="shrink-0 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Edit client
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
                <StatCard label="Total Billed" value={totalBilled} />
                <StatCard label="Total Received" value={totalReceived} accent="text-green-600" />
                <StatCard
                  label="Outstanding Balance"
                  value={outstandingBalance}
                  accent={outstandingBalance > 0 ? "text-red-600" : "text-gray-900"}
                />
                <StatCard label="Unallocated Credit" value={unallocatedCredit} accent="text-blue-600" />
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-gray-200 mb-4">
              {[
                { key: "tickets", label: "Tickets" },
                { key: "payments", label: "Payment History" },
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
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {tickets.length === 0 ? (
                  <div className="py-16 text-center text-sm text-gray-400">No tickets for this client yet.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-left">
                        <th className="px-4 py-3 font-medium text-gray-500">Passenger</th>
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
                        const outstanding = (ticket.sell_price ?? 0) - (ticket.amount_paid ?? 0)
                        const statusBadge = paymentStatusBadge(ticket.payment_status)
                        const chips = computeTicketChips(ticket)
                        return (
                          <tr
                            key={ticket.id}
                            onClick={() => setViewingTicket(ticket)}
                            className="hover:bg-gray-50 transition-colors cursor-pointer"
                          >
                            <td className="px-4 py-3 font-medium text-gray-900">{ticket.passenger_name}</td>
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
                          <td className="px-4 py-3 text-gray-600">{payment.channel ?? "—"}</td>
                          <td className="px-4 py-3 text-gray-600">{payment.trx_id ?? "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-600">{fmt(payment.unallocated_amount)}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs max-w-[180px] truncate">
                            {payment.notes ?? <span className="text-gray-200">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {(payment.unallocated_amount ?? 0) > 0 && (
                              <button
                                onClick={() => setAllocationTarget(payment)}
                                className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
                              >
                                Allocate
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={() => setLogPaymentOpen(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Log Payment
              </button>
              {unallocatedCredit > 0 && (
                <button
                  onClick={handleSettle}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Settle
                </button>
              )}
            </div>
          </>
        )}
      </main>

      <ClientModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        onSaved={(saved) => setClient(saved)}
        client={client}
      />

      <TicketDetailModal
        isOpen={!!viewingTicket}
        onClose={() => setViewingTicket(null)}
        ticket={viewingTicket}
        tickets={tickets}
        onNavigate={handleNavigateTicket}
      />

      <LogPaymentModal
        isOpen={logPaymentOpen}
        onClose={() => setLogPaymentOpen(false)}
        client={client}
        suppliers={suppliers}
        onLogged={handleLogged}
      />

      <AllocationModal
        isOpen={!!allocationTarget}
        onClose={() => setAllocationTarget(null)}
        payment={allocationTarget}
        tickets={tickets}
        onAllocated={fetchAll}
      />
    </div>
  )
}
