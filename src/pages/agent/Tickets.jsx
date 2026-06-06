import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { useNavigate } from "react-router-dom"
import TicketModal from "../../components/tickets/TicketModal"

const STATUS_STYLES = {
  booked:        "bg-blue-100 text-blue-700",
  collected:     "bg-yellow-100 text-yellow-700",
  supplier_paid: "bg-orange-100 text-orange-700",
  flown:         "bg-green-100 text-green-700",
  closed:        "bg-gray-100 text-gray-600",
}

const STATUS_LABELS = {
  booked:        "Booked",
  collected:     "Collected",
  supplier_paid: "Supplier Paid",
  flown:         "Flown",
  closed:        "Closed",
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] ?? "bg-gray-100 text-gray-600"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

function fmt(n) {
  if (n == null) return "—"
  return Number(n).toLocaleString("en-BD")
}

export default function Tickets() {
  const { agent, user, signOut } = useAuth()
  const navigate = useNavigate()

  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTicket, setEditingTicket] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (agent?.id) fetchTickets()
  }, [agent])

  const fetchTickets = async () => {
    setLoading(true)
    setError("")
    const { data, error } = await supabase
      .from("tickets")
      .select(`
        id, passenger_name, route, travel_date, carrier,
        purchase_price, sell_price, reported_price, status,
        client_id, supplier_id,
        clients(name),
        suppliers(name),
        created_at
      `)
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })

    setLoading(false)
    if (error) setError(error.message)
    else setTickets(data)
  }

  const handleLogout = async () => {
    await signOut()
    navigate("/login")
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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Tickets</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user?.email}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-red-600 hover:text-red-700 font-medium transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">All tickets</h2>
            <p className="text-sm text-gray-500 mt-0.5">Track and manage your travel tickets</p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add ticket
          </button>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

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
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left">
                    <th className="px-4 py-3 font-medium text-gray-500">Passenger</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Route</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Travel Date</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Carrier</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Client</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Supplier</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Sell</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Purchase</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Margin</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Status</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tickets.map((ticket) => {
                    const margin = (ticket.sell_price ?? 0) - (ticket.purchase_price ?? 0)
                    return (
                      <tr key={ticket.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900">{ticket.passenger_name}</td>
                        <td className="px-4 py-3 text-gray-600 font-mono text-xs">{ticket.route}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {ticket.travel_date
                            ? new Date(ticket.travel_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{ticket.carrier}</td>
                        <td className="px-4 py-3 text-gray-600">{ticket.clients?.name ?? <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-3 text-gray-600">{ticket.suppliers?.name ?? <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-3 text-gray-600 text-right tabular-nums">{fmt(ticket.sell_price)}</td>
                        <td className="px-4 py-3 text-gray-600 text-right tabular-nums">{fmt(ticket.purchase_price)}</td>
                        <td className={`px-4 py-3 text-right tabular-nums font-medium ${margin >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {fmt(margin)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={ticket.status} />
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
                            <div className="flex items-center justify-end gap-3">
                              <button
                                onClick={() => openEdit(ticket)}
                                className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(ticket.id)}
                                className="text-red-500 hover:text-red-600 font-medium transition-colors"
                              >
                                Delete
                              </button>
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

        {!loading && tickets.length > 0 && (
          <p className="mt-3 text-xs text-gray-400">{tickets.length} ticket{tickets.length !== 1 ? "s" : ""}</p>
        )}
      </main>

      <TicketModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
        ticket={editingTicket}
      />
    </div>
  )
}
