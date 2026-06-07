import { useState } from "react"
import { supabase } from "../../lib/supabase"

export default function VoidConfirmModal({ isOpen, onClose, ticket, onSaved }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  if (!isOpen) return null

  const handleConfirm = async () => {
    setLoading(true)
    setError("")
    const { data, error } = await supabase
      .from("tickets")
      .update({ is_void: true, status: "void" })
      .eq("id", ticket.id)
      .select(`*, clients(name), suppliers(name)`)
      .single()

    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    onSaved(data)
    onClose()
  }

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      onMouseDown={handleBackdrop}
    >
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl flex flex-col">
        <div className="px-6 py-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Void this ticket?</h2>
          <p className="text-sm text-gray-500">
            Mark this ticket as void? This cannot be undone.
          </p>
          {error && (
            <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Voiding…" : "Mark as void"}
          </button>
        </div>
      </div>
    </div>
  )
}
