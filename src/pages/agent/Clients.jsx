import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { useNavigate } from "react-router-dom"
import ClientModal from "../../components/clients/ClientModal"

function clientIdLabel(num) {
  if (num == null) return "—"
  return `C-${String(num).padStart(3, "0")}`
}

function fmt(n) {
  return Number(n ?? 0).toLocaleString("en-BD")
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

export default function Clients() {
  const { agent, user, signOut } = useAuth()
  const navigate = useNavigate()

  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [editingClient, setEditingClient] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [openActionMenuId, setOpenActionMenuId] = useState(null)

  useEffect(() => {
    if (agent?.id) fetchClients()
  }, [agent])

  const fetchClients = async () => {
    setLoading(true)
    setError("")

    const [{ data: clientRows, error }, { data: ticketRows }, { data: paymentRows }] = await Promise.all([
      supabase
        .from("clients")
        .select("id, name, phone, email, notes, client_id_number, created_at")
        .eq("agent_id", agent.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("tickets")
        .select("client_id, sell_price")
        .eq("agent_id", agent.id)
        .not("client_id", "is", null),
      supabase
        .from("payments")
        .select("client_id, amount, unallocated_amount")
        .eq("agent_id", agent.id)
        .eq("type", "client_payment")
        .not("client_id", "is", null),
    ])

    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }

    // Single pass over each table — grouped by client_id — instead of querying per client
    const billed = new Map()
    for (const t of ticketRows ?? []) {
      billed.set(t.client_id, (billed.get(t.client_id) ?? 0) + (t.sell_price ?? 0))
    }
    const received = new Map()
    const unallocated = new Map()
    for (const p of paymentRows ?? []) {
      received.set(p.client_id, (received.get(p.client_id) ?? 0) + (p.amount ?? 0))
      unallocated.set(p.client_id, (unallocated.get(p.client_id) ?? 0) + (p.unallocated_amount ?? 0))
    }

    setClients(
      (clientRows ?? []).map((c) => {
        const totalBilled = billed.get(c.id) ?? 0
        const totalReceived = received.get(c.id) ?? 0
        return {
          ...c,
          totalBilled,
          totalReceived,
          outstanding: totalBilled - totalReceived,
          unallocatedCredit: unallocated.get(c.id) ?? 0,
        }
      })
    )
  }

  const handleLogout = async () => {
    await signOut()
    navigate("/login")
  }

  const openAdd = () => {
    setEditingClient(null)
    setModalOpen(true)
  }

  const openEdit = (client) => {
    setEditingClient(client)
    setModalOpen(true)
  }

  const handleSaved = (saved) => {
    setClients((prev) => {
      const exists = prev.find((c) => c.id === saved.id)
      if (exists) return prev.map((c) => (c.id === saved.id ? { ...c, ...saved } : c))
      return [{ ...saved, totalBilled: 0, totalReceived: 0, outstanding: 0, unallocatedCredit: 0 }, ...prev]
    })
  }

  const handleDelete = async (id) => {
    setDeleting(true)
    const { error } = await supabase.from("clients").delete().eq("id", id)
    setDeleting(false)
    if (error) {
      setError(error.message)
    } else {
      setClients((prev) => prev.filter((c) => c.id !== id))
      setConfirmDeleteId(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Clients</h1>
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

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page title + action */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">All clients</h2>
            <p className="text-sm text-gray-500 mt-0.5">Manage your travel clients</p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add client
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="py-20 text-center text-sm text-gray-400">Loading clients…</div>
          ) : clients.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-gray-400 text-sm">No clients yet.</p>
              <button
                onClick={openAdd}
                className="mt-3 text-blue-600 hover:underline text-sm font-medium"
              >
                Add your first client
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left">
                  <th className="px-5 py-3 font-medium text-gray-500">Client ID</th>
                  <th className="px-5 py-3 font-medium text-gray-500">Name</th>
                  <th className="px-5 py-3 font-medium text-gray-500">Phone</th>
                  <th className="px-5 py-3 font-medium text-gray-500">Email</th>
                  <th className="px-5 py-3 font-medium text-gray-500 text-right">Total Billed</th>
                  <th className="px-5 py-3 font-medium text-gray-500 text-right">Total Received</th>
                  <th className="px-5 py-3 font-medium text-gray-500 text-right">Outstanding</th>
                  <th className="px-5 py-3 font-medium text-gray-500 text-right">Unallocated Credit</th>
                  <th className="px-5 py-3 font-medium text-gray-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clients.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-xs font-semibold tracking-wide">
                        {clientIdLabel(client.client_id_number)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-gray-900">{client.name}</td>
                    <td className="px-5 py-3.5 text-gray-600">{client.phone || <span className="text-gray-300">—</span>}</td>
                    <td className="px-5 py-3.5 text-gray-600">{client.email || <span className="text-gray-300">—</span>}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-gray-700">{fmt(client.totalBilled)}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-gray-700">{fmt(client.totalReceived)}</td>
                    <td className={`px-5 py-3.5 text-right tabular-nums font-medium ${client.outstanding > 0 ? "text-red-600" : "text-green-600"}`}>
                      {fmt(client.outstanding)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-gray-700">{fmt(client.unallocatedCredit)}</td>
                    <td className="px-5 py-3.5 text-right">
                      {confirmDeleteId === client.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-gray-500 text-xs">Delete this client?</span>
                          <button
                            onClick={() => handleDelete(client.id)}
                            disabled={deleting}
                            className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 px-2.5 py-1 rounded-md transition-colors"
                          >
                            {deleting ? "Deleting…" : "Yes, delete"}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs font-medium text-gray-600 hover:text-gray-800 px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-100 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <RowActionsMenu
                          isOpen={openActionMenuId === client.id}
                          onToggle={() => setOpenActionMenuId((prev) => (prev === client.id ? null : client.id))}
                          onClose={() => setOpenActionMenuId(null)}
                          items={[
                            { key: "view", label: "View", cls: "text-gray-700", onClick: () => navigate(`/clients/${client.id}`) },
                            { key: "edit", label: "Edit", cls: "text-blue-600", onClick: () => openEdit(client) },
                            { key: "delete", label: "Delete", cls: "text-red-500", onClick: () => setConfirmDeleteId(client.id) },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>

        {!loading && clients.length > 0 && (
          <p className="mt-3 text-xs text-gray-400">{clients.length} client{clients.length !== 1 ? "s" : ""}</p>
        )}
      </main>

      <ClientModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
        client={editingClient}
      />
    </div>
  )
}
