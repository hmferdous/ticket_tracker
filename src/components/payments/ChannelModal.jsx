import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { suggestUniqueName } from "../../lib/channels"

export default function ChannelModal({ isOpen, onClose, agentId, channel, existingChannels, onSaved }) {
  const [name, setName] = useState("")
  const [startingBalance, setStartingBalance] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [pendingSuggestion, setPendingSuggestion] = useState("")

  useEffect(() => {
    if (isOpen) {
      setName(channel?.name ?? "")
      setStartingBalance(channel?.starting_balance != null ? String(channel.starting_balance) : "")
      setError("")
      setPendingSuggestion("")
    }
  }, [isOpen, channel])

  if (!isOpen) return null

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  const save = async (finalName) => {
    const balance = startingBalance !== "" ? parseFloat(startingBalance) : 0
    if (isNaN(balance)) {
      setError("Enter a valid starting balance")
      return
    }

    setLoading(true)
    setError("")

    const result = channel
      ? await supabase
          .from("payment_channels")
          .update({ name: finalName, starting_balance: balance })
          .eq("id", channel.id)
          .select()
          .single()
      : await supabase
          .from("payment_channels")
          .insert({ agent_id: agentId, name: finalName, starting_balance: balance })
          .select()
          .single()

    setLoading(false)
    if (result.error) {
      setError(result.error.code === "23505" ? "That name is already in use. Try a different one." : result.error.message)
      return
    }
    onSaved(result.data)
    onClose()
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")
    const trimmed = name.trim()
    if (!trimmed) {
      setError("Enter a channel name")
      return
    }

    const collision = (existingChannels ?? []).some(
      (c) => c.id !== channel?.id && c.name.trim().toLowerCase() === trimmed.toLowerCase()
    )
    if (collision) {
      setPendingSuggestion(suggestUniqueName((existingChannels ?? []).map((c) => c.name), trimmed))
      return
    }
    save(trimmed)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6" onMouseDown={handleBackdrop}>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{channel ? "Edit Channel" : "Add Channel"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
          )}

          {pendingSuggestion ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-700">
                A channel named "{name.trim()}" already exists. Save this one as{" "}
                <span className="font-semibold">"{pendingSuggestion}"</span> instead?
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setPendingSuggestion("")}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Change name
                </button>
                <button
                  type="button"
                  onClick={() => save(pendingSuggestion)}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {loading ? "Saving…" : `Use "${pendingSuggestion}"`}
                </button>
              </div>
            </div>
          ) : (
            <form id="channel-form" onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Channel Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. bKash"
                  className={inputCls}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Starting Balance</label>
                <input
                  type="number"
                  step="0.01"
                  value={startingBalance}
                  onChange={(e) => setStartingBalance(e.target.value)}
                  placeholder="0.00"
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-gray-400">Optional — balance already in this wallet before you started tracking here</p>
              </div>
            </form>
          )}
        </div>

        {!pendingSuggestion && (
          <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="channel-form"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? "Saving…" : channel ? "Save changes" : "Add channel"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
