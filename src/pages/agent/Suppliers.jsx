import { useEffect, useState } from "react"
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
          <div className="absolute right-0 top-full z-20 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-100 py-1">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => { onClose(); item.onClick() }}
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
    if (error) {
      setError(error.message)
      return
    }

    // Single pass over each table — grouped by supplier_id — instead of querying per supplier
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

  const openAdd = () => {
    setEditingSupplier(null)
    setModalOpen(true)
  }

  const openEdit = (supplier) => {
    setEditingSupplier(supplier)
    setModalOpen(true)
  }

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
    if (error) {
      setError(error.message)
    } else {
      setSuppliers((prev) => prev.filter((s) => s.id !== id))
      setConfirmDeleteId(null)
    }
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
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="py-20 text-center text-sm text-gray-400">Loading suppliers…</div>
          ) : suppliers.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-gray-400 text-sm">No suppliers yet.</p>
              <button
                onClick={openAdd}
                className="mt-3 text-blue-600 hover:underline text-sm font-medium"
              >
                Add your first supplier
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left">
                    <th className="px-5 py-3 font-medium text-gray-500">Supplier ID</th>
                    <th className="px-5 py-3 font-medium text-gray-500">Name</th>
                    <th className="px-5 py-3 font-medium text-gray-500">Phone</th>
                    <th className="px-5 py-3 font-medium text-gray-500">Email</th>
                    <th className="px-5 py-3 font-medium text-gray-500 text-right">Total Purchased</th>
                    <th className="px-5 py-3 font-medium text-gray-500 text-right">Total Paid</th>
                    <th className="px-5 py-3 font-medium text-gray-500 text-right">Outstanding Payable</th>
                    <th className="px-5 py-3 font-medium text-gray-500 text-right">Unallocated</th>
                    <th className="px-5 py-3 font-medium text-gray-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {suppliers.map((supplier) => (
                    <tr key={supplier.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 text-xs font-semibold tracking-wide">
                          {supplierIdLabel(supplier.supplier_id_number)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-medium text-gray-900">{supplier.name}</td>
                      <td className="px-5 py-3.5 text-gray-600">{supplier.phone || <span className="text-gray-300">—</span>}</td>
                      <td className="px-5 py-3.5 text-gray-600">{supplier.email || <span className="text-gray-300">—</span>}</td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-gray-700">{fmt(supplier.totalPurchased)}</td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-gray-700">{fmt(supplier.totalPaid)}</td>
                      <td className={`px-5 py-3.5 text-right tabular-nums font-medium ${supplier.outstandingPayable > 0 ? "text-red-600" : "text-green-600"}`}>
                        {fmt(supplier.outstandingPayable)}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-gray-700">{fmt(supplier.unallocated)}</td>
                      <td className="px-5 py-3.5 text-right">
                        {confirmDeleteId === supplier.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-gray-500 text-xs">Delete?</span>
                            <button
                              onClick={() => handleDelete(supplier.id)}
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
                              isOpen={openMenuId === supplier.id}
                              onToggle={() => setOpenMenuId((id) => id === supplier.id ? null : supplier.id)}
                              onClose={() => setOpenMenuId(null)}
                              items={[
                                { key: "view", label: "View", cls: "text-gray-700", onClick: () => navigate(`/suppliers/${supplier.id}`) },
                                { key: "edit", label: "Edit", cls: "text-blue-600", onClick: () => openEdit(supplier) },
                                { key: "delete", label: "Delete", cls: "text-red-600", onClick: () => setConfirmDeleteId(supplier.id) },
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
          <p className="mt-3 text-xs text-gray-400">{suppliers.length} supplier{suppliers.length !== 1 ? "s" : ""}</p>
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
