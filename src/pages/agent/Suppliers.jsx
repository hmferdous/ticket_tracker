import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import SupplierModal from "../../components/suppliers/SupplierModal"
import AppLayout from "../../components/layout/AppLayout"

function supplierIdLabel(num) {
  if (num == null) return "—"
  return `S-${String(num).padStart(3, "0")}`
}

export default function Suppliers() {
  const { agent } = useAuth()

  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (agent?.id) fetchSuppliers()
  }, [agent])

  const fetchSuppliers = async () => {
    setLoading(true)
    setError("")
    const { data, error } = await supabase
      .from("suppliers")
      .select("id, name, phone, email, notes, supplier_id_number, created_at")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })

    setLoading(false)
    if (error) setError(error.message)
    else setSuppliers(data)
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
      if (exists) return prev.map((s) => (s.id === saved.id ? saved : s))
      return [saved, ...prev]
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
      <div className="max-w-5xl mx-auto px-6 py-8">
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left">
                  <th className="px-5 py-3 font-medium text-gray-500">Supplier ID</th>
                  <th className="px-5 py-3 font-medium text-gray-500">Name</th>
                  <th className="px-5 py-3 font-medium text-gray-500">Phone</th>
                  <th className="px-5 py-3 font-medium text-gray-500">Email</th>
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
                    <td className="px-5 py-3.5 text-right">
                      {confirmDeleteId === supplier.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-gray-500 text-xs">Delete this supplier?</span>
                          <button
                            onClick={() => handleDelete(supplier.id)}
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
                            onClick={() => openEdit(supplier)}
                            className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(supplier.id)}
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
