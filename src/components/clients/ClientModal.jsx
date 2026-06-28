import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import { createClient } from "../tickets/TicketModal"
import DocUploadSection, { uploadStagedDocuments } from "../ui/DocUploadSection"

const EMPTY = { name: "", phone: "", email: "", notes: "" }

export default function ClientModal({ isOpen, onClose, onSaved, client }) {
  const { agent } = useAuth()
  const [form, setForm] = useState(EMPTY)
  const [staged, setStaged] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (isOpen) {
      setForm(client ? { name: client.name, phone: client.phone ?? "", email: client.email ?? "", notes: client.notes ?? "" } : EMPTY)
      setStaged([])
      setError("")
    }
  }, [isOpen, client])

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      notes: form.notes.trim() || null,
    }

    let saved
    if (client?.id) {
      const result = await supabase.from("clients").update(payload).eq("id", client.id).select().single()
      if (result.error) {
        setError(result.error.message)
        setLoading(false)
        return
      }
      saved = result.data
    } else {
      try {
        const created = await createClient(supabase, agent.id, payload.name, {
          phone: payload.phone,
          email: payload.email,
          notes: payload.notes,
        })
        saved = { ...created, ...payload }
      } catch (err) {
        setError(err.message)
        setLoading(false)
        return
      }
    }

    if (staged.length > 0) {
      try {
        await uploadStagedDocuments(supabase, agent.id, "client", saved.id, staged)
      } catch (err) {
        // Documents failed but entity was saved — surface the error without blocking close
        setError(`Saved, but document upload failed: ${err.message}`)
        setLoading(false)
        onSaved(saved)
        return
      }
    }

    setLoading(false)
    onSaved(saved)
    onClose()
  }

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onMouseDown={handleBackdrop}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">
            {client ? "Edit client" : "Add client"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={set("name")}
              placeholder="Client full name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={set("phone")}
              placeholder="+880 1XX-XXXXXXX"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={set("email")}
              placeholder="client@example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={set("notes")}
              placeholder="Any additional notes…"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>

          <DocUploadSection staged={staged} onChange={setStaged} />

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? "Saving…" : client ? "Save changes" : "Add client"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
