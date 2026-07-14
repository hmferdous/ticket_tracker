import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { useNavigate } from "react-router-dom"
import SupplierModal from "../../components/suppliers/SupplierModal"
import AppLayout from "../../components/layout/AppLayout"

function supplierIdLabel(num) {
  if (num == null) return "—"
  return `S-${String(num).padStart(3, "0")}`
}

function fmt(n) {
  return Number(n ?? 0).toLocaleString("en-BD")
}

function RowActionsMenu({ isOpen, onToggle, onClose, items }) {
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

export default function Suppliers() {
  const { agent } = useAuth()
  const navigate = useNavigate()

  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [openMenuId, setOpenMenuId] = useState(null)
  const [search, setSearch] = useState("")
  const [outstandingFilter, setOutstandingFilter] = useState("all")

  useEffect(() => {
    if (agent?.id) fetchSuppliers()
  }, [agent])

  const fetchSuppliers = async () => {
    setLoading(true)
    setError("")

    const [{ data: supplierRows, error }, { data: ticketRows }, { data: paymentRows }] = await Promise.all([
      supabase
        .from("suppliers")
        .select("id, name, phone, email, notes, supplier_id_number, created_at")
        .eq("agent_id", agent.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("tickets")
        .select("supplier_id, purchase_price")
        .eq("agent_id", agent.id)
        .not("supplier_id", "is", null),
      supabase
        .from("payments")
        .select("supplier_id, amount, unallocated_amount")
        .eq("agent_id", agent.id)
        .eq("type", "supplier_payment")
        .not("supplier_id", "is", null),
    ])

    setLoading(false)
    if (error) { setError(error.message); return }

    const purchased = new Map()
    for (const t of ticketRows ?? []) {
      purchased.set(t.supplier_id, (purchased.get(t.supplier_id) ?? 0) + (t.purchase_price ?? 0))
    }
    const paid = new Map()
    const unallocated = new Map()
    for (const p of paymentRows ?? []) {
      paid.set(p.supplier_id, (paid.get(p.supplier_id) ?? 0) + (p.amount ?? 0))
      unallocated.set(p.supplier_id, (unallocated.get(p.supplier_id) ?? 0) + (p.unallocated_amount ?? 0))
    }

    setSuppliers(
      (supplierRows ?? []).map((s) => {
        const totalPurchased = purchased.get(s.id) ?? 0
        const totalPaid = paid.get(s.id) ?? 0
        return {
          ...s,
          totalPurchased,
          totalPaid,
          outstandingPayable: totalPurchased - totalPaid,
          unallocated: unallocated.get(s.id) ?? 0,
        }
      })
    )
  }

  const filteredSuppliers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return suppliers.filter((s) => {
      if (q) {
        const idLabel = supplierIdLabel(s.supplier_id_number).toLowerCase()
        if (
          !s.name?.toLowerCase().includes(q) &&
          !s.phone?.toLowerCase().includes(q) &&
          !s.email?.toLowerCase().includes(q) &&
          !idLabel.includes(q)
        ) return false
      }
      if (outstandingFilter === "outstanding" && s.outstandingPayable <= 0) return false
      if (outstandingFilter === "cleared" && s.outstandingPayable > 0) return false
      return true
    })
  }, [suppliers, search, outstandingFilter])

  const openAdd = () => { setEditingSupplier(null); setModalOpen(true) }
  const openEdit = (supplier) => { setEditingSupplier(supplier); setModalOpen(true) }

  const handleSaved = (saved) => {
    setSuppliers((prev) => {
      const exists = prev.find((s) => s.id === saved.id)
      if (exists) return prev.map((s) => (s.id === saved.id ? { ...s, ...saved } : s))
      return [{ ...saved, totalPurchased: 0, totalPaid: 0, outstandingPayable: 0, unallocated: 0 }, ...prev]
    })
  }

  const handleDelete = async (id) => {
    setDeleting(true)
    const { error } = await supabase.from("suppliers").delete().eq("id", id)
    setDeleting(false)
    if (error) { setError(error.message) }
    else { setSuppliers((prev) => prev.filter((s) => s.id !== id)); setConfirmDeleteId(null) }
  }

  return (
    <AppLayout
      title="Suppliers"
      actions={
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add supplier
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
            <option value="all">All suppliers</option>
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
            <div className="py-20 text-center text-sm text-gray-400 dark:text-gray-500">Loading suppliers…</div>
          ) : suppliers.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-gray-400 dark:text-gray-500 text-sm">No suppliers yet.</p>
              <button onClick={openAdd} className="mt-3 text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium">
                Add your first supplier
              </button>
            </div>
          ) : filteredSuppliers.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-gray-400 dark:text-gray-500 text-sm">No suppliers match your search.</p>
              <button onClick={() => { setSearch(""); setOutstandingFilter("all") }} className="mt-3 text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium">
                Clear filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 text-left">
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Supplier ID</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Name</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Phone</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Email</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Total Purchased</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Total Paid</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Outstanding Payable</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Unallocated</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredSuppliers.map((supplier) => (
                    <tr key={supplier.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 text-xs font-semibold tracking-wide">
                          {supplierIdLabel(supplier.supplier_id_number)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-semibold text-gray-900 dark:text-gray-100">{supplier.name}</td>
                      <td className="px-5 py-3.5 text-gray-500 dark:text-gray-400">{supplier.phone || <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                      <td className="px-5 py-3.5 text-gray-500 dark:text-gray-400">{supplier.email || <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                      <td className="px-5 py-3.5 text-right tabular-nums font-medium text-gray-700 dark:text-gray-300">{fmt(supplier.totalPurchased)}</td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-gray-600 dark:text-gray-400">{fmt(supplier.totalPaid)}</td>
                      <td className={`px-5 py-3.5 text-right tabular-nums font-semibold ${supplier.outstandingPayable > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                        {fmt(supplier.outstandingPayable)}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-gray-600 dark:text-gray-400">{fmt(supplier.unallocated)}</td>
                      <td className="px-5 py-3.5 text-right">
                        {confirmDeleteId === supplier.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-gray-500 dark:text-gray-400 text-xs">Delete?</span>
                            <button
                              onClick={() => handleDelete(supplier.id)}
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
                              isOpen={openMenuId === supplier.id}
                              onToggle={() => setOpenMenuId((id) => id === supplier.id ? null : supplier.id)}
                              onClose={() => setOpenMenuId(null)}
                              items={[
                                { key: "view", label: "View", cls: "text-gray-700 dark:text-gray-300", onClick: () => navigate(`/suppliers/${supplier.id}`) },
                                { key: "edit", label: "Edit", cls: "text-blue-600 dark:text-blue-400", onClick: () => openEdit(supplier) },
                                { key: "delete", label: "Delete", cls: "text-red-600 dark:text-red-400", onClick: () => setConfirmDeleteId(supplier.id) },
                              ]}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && suppliers.length > 0 && (
          <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
            {filteredSuppliers.length === suppliers.length
              ? `${suppliers.length} supplier${suppliers.length !== 1 ? "s" : ""}`
              : `${filteredSuppliers.length} of ${suppliers.length} suppliers`}
          </p>
        )}
      </div>

      <SupplierModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
        supplier={editingSupplier}
      />
    </AppLayout>
  )
}
