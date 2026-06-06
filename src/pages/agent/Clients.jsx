import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { useNavigate } from "react-router-dom"
import ClientModal from "../../components/clients/ClientModal"

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

  useEffect(() => {
    if (agent?.id) fetchClients()
  }, [agent])

  const fetchClients = async () => {
    setLoading(true)
    setError("")
    const { data, error } = await supabase
      .from("clients")
      .select("id, name, phone, email, notes, created_at")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })

    setLoading(false)
    if (error) setError(error.message)
    else setClients(data)
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
      if (exists) return prev.map((c) => (c.id === saved.id ? saved : c))
      return [saved, ...prev]
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

      <main className="max-w-5xl mx-auto px-6 py-8">
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left">
                  <th className="px-5 py-3 font-medium text-gray-500">Name</th>
                  <th className="px-5 py-3 font-medium text-gray-500">Phone</th>
                  <th className="px-5 py-3 font-medium text-gray-500">Email</th>
                  <th className="px-5 py-3 font-medium text-gray-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clients.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-gray-900">{client.name}</td>
                    <td className="px-5 py-3.5 text-gray-600">{client.phone || <span className="text-gray-300">—</span>}</td>
                    <td className="px-5 py-3.5 text-gray-600">{client.email || <span className="text-gray-300">—</span>}</td>
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
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => openEdit(client)}
                            className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(client.id)}
                            className="text-red-500 hover:text-red-600 font-medium transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
