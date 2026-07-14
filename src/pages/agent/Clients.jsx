import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { useNavigate } from "react-router-dom"
import ClientModal from "../../components/clients/ClientModal"
import AppLayout from "../../components/layout/AppLayout"

function clientIdLabel(num) {
  if (num == null) return "—"
  return `C-${String(num).padStart(3, "0")}`
}

function fmt(n) {
  return Number(n ?? 0).toLocaleString("en-BD")
}

function RowActionsMenu({ items, isOpen, onToggle, onClose }) {
  const btnRef = useRef(null)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })

  const handleToggle = () => {
    if (!isOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const menuHeight = items.length * 36 + 8
      setMenuPos({
        top: window.innerHeight - rect.bottom >= menuHeight ? rect.bottom + 4 : rect.top - menuHeight - 4,
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

  if (items.length === 0) return <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
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
            className="fixed z-50 w-44 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 py-1 overflow-hidden"
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

export default function Clients() {
  const { agent } = useAuth()
  const navigate = useNavigate()

  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [editingClient, setEditingClient] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [openActionMenuId, setOpenActionMenuId] = useState(null)
  const [search, setSearch] = useState("")
  const [outstandingFilter, setOutstandingFilter] = useState("all")

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
    if (error) { setError(error.message); return }

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

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase()
    return clients.filter((c) => {
      if (q) {
        const idLabel = clientIdLabel(c.client_id_number).toLowerCase()
        if (
          !c.name?.toLowerCase().includes(q) &&
          !c.phone?.toLowerCase().includes(q) &&
          !c.email?.toLowerCase().includes(q) &&
          !idLabel.includes(q)
        ) return false
      }
      if (outstandingFilter === "outstanding" && c.outstanding <= 0) return false
      if (outstandingFilter === "cleared" && c.outstanding > 0) return false
      return true
    })
  }, [clients, search, outstandingFilter])

  const openAdd = () => { setEditingClient(null); setModalOpen(true) }
  const openEdit = (client) => { setEditingClient(client); setModalOpen(true) }

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
    if (error) { setError(error.message) }
    else { setClients((prev) => prev.filter((c) => c.id !== id)); setConfirmDeleteId(null) }
  }

  return (
    <AppLayout
      title="Clients"
      actions={
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add client
        </button>
      }
    >
      <div className="max-w-7xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">{error}</div>
        )}

        {/* Search & filter bar */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px] relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone, ID…"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <select
            value={outstandingFilter}
            onChange={(e) => setOutstandingFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All clients</option>
            <option value="outstanding">Has outstanding</option>
            <option value="cleared">Cleared</option>
          </select>
          {(search || outstandingFilter !== "all") && (
            <button
              onClick={() => { setSearch(""); setOutstandingFilter("all") }}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="py-20 text-center text-sm text-gray-400 dark:text-gray-500">Loading clients…</div>
          ) : clients.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-gray-400 dark:text-gray-500 text-sm">No clients yet.</p>
              <button onClick={openAdd} className="mt-3 text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium">
                Add your first client
              </button>
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-gray-400 dark:text-gray-500 text-sm">No clients match your search.</p>
              <button onClick={() => { setSearch(""); setOutstandingFilter("all") }} className="mt-3 text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium">
                Clear filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 text-left">
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Client ID</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Name</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Phone</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Email</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Total Billed</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Total Received</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Outstanding</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Unallocated Credit</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredClients.map((client) => (
                    <tr key={client.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-xs font-semibold tracking-wide">
                          {clientIdLabel(client.client_id_number)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-semibold text-gray-900 dark:text-gray-100">{client.name}</td>
                      <td className="px-5 py-3.5 text-gray-500 dark:text-gray-400">{client.phone || <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                      <td className="px-5 py-3.5 text-gray-500 dark:text-gray-400">{client.email || <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                      <td className="px-5 py-3.5 text-right tabular-nums font-medium text-gray-700 dark:text-gray-300">{fmt(client.totalBilled)}</td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-gray-600 dark:text-gray-400">{fmt(client.totalReceived)}</td>
                      <td className={`px-5 py-3.5 text-right tabular-nums font-semibold ${client.outstanding > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                        {fmt(client.outstanding)}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-gray-600 dark:text-gray-400">{fmt(client.unallocatedCredit)}</td>
                      <td className="px-5 py-3.5 text-right">
                        {confirmDeleteId === client.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-gray-500 dark:text-gray-400 text-xs">Delete?</span>
                            <button
                              onClick={() => handleDelete(client.id)}
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
                          <RowActionsMenu
                            isOpen={openActionMenuId === client.id}
                            onToggle={() => setOpenActionMenuId((prev) => (prev === client.id ? null : client.id))}
                            onClose={() => setOpenActionMenuId(null)}
                            items={[
                              { key: "view", label: "View", cls: "text-gray-700 dark:text-gray-300", onClick: () => navigate(`/clients/${client.id}`) },
                              { key: "edit", label: "Edit", cls: "text-blue-600 dark:text-blue-400", onClick: () => openEdit(client) },
                              { key: "delete", label: "Delete", cls: "text-red-500 dark:text-red-400", onClick: () => setConfirmDeleteId(client.id) },
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
          <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
            {filteredClients.length === clients.length
              ? `${clients.length} client${clients.length !== 1 ? "s" : ""}`
              : `${filteredClients.length} of ${clients.length} clients`}
          </p>
        )}
      </div>

      <ClientModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
        client={editingClient}
      />
    </AppLayout>
  )
}
