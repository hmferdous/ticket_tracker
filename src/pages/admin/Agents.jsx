import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../lib/supabase"
import AdminLayout from "../../components/layout/AdminLayout"

const PLAN_LABELS = {
  trial: "Trial",
  monthly: "Monthly",
  semi_annual: "Semi-annual",
  annual: "Annual",
}

const PLAN_BADGE_CLASSES = {
  trial: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300",
  monthly: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
  semi_annual: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400",
  annual: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
}

const PLAN_OPTIONS = [
  { value: "", label: "All Plans" },
  { value: "trial", label: "Trial" },
  { value: "monthly", label: "Monthly" },
  { value: "semi_annual", label: "Semi-annual" },
  { value: "annual", label: "Annual" },
]

const STATUS_OPTIONS = [
  { value: "", label: "All Status" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
]

function fmtDate(d) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function fmtDateInput(d) {
  if (!d) return ""
  return new Date(d).toISOString().slice(0, 10)
}

function planExpiry(agentRow) {
  return agentRow.plan === "trial" ? agentRow.trial_ends_at : agentRow.plan_ends_at
}

function isExpired(agentRow) {
  const expiry = planExpiry(agentRow)
  if (!expiry) return false
  return new Date(expiry) < new Date()
}

function Badge({ label, className }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${className}`}>
      {label}
    </span>
  )
}

export default function Agents() {
  const [agents, setAgents] = useState([])
  const [ticketCounts, setTicketCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [searchText, setSearchText] = useState("")
  const [planFilter, setPlanFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")

  const [managingAgent, setManagingAgent] = useState(null)

  useEffect(() => {
    fetchAgents()
    fetchTicketCounts()
  }, [])

  const fetchAgents = async () => {
    setLoading(true)
    setError("")
    const { data, error } = await supabase
      .from("agents")
      .select("id, full_name, email, plan, trial_ends_at, plan_ends_at, deactivated, is_admin, created_at")
      .order("created_at", { ascending: false })

    setLoading(false)
    if (error) setError(error.message)
    else setAgents(data ?? [])
  }

  const fetchTicketCounts = async () => {
    const { data, error } = await supabase.from("tickets").select("agent_id")
    if (error) return
    const counts = {}
    for (const row of data ?? []) {
      counts[row.agent_id] = (counts[row.agent_id] ?? 0) + 1
    }
    setTicketCounts(counts)
  }

  const clearFilters = () => {
    setSearchText("")
    setPlanFilter("")
    setStatusFilter("")
  }

  const filteredAgents = useMemo(() => {
    const search = searchText.trim().toLowerCase()
    return agents.filter((a) => {
      if (search) {
        const haystack = `${a.full_name ?? ""} ${a.email ?? ""}`.toLowerCase()
        if (!haystack.includes(search)) return false
      }
      if (planFilter && a.plan !== planFilter) return false
      if (statusFilter === "active" && isExpired(a)) return false
      if (statusFilter === "expired" && !isExpired(a)) return false
      return true
    })
  }, [agents, searchText, planFilter, statusFilter])

  const handleAgentUpdated = (updated) => {
    setAgents((prev) => prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)))
  }

  return (
    <AdminLayout title="Agents">
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Filter bar */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Search</label>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Name or email…"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="w-44">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Plan</label>
              <select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {PLAN_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="w-40">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={clearFilters}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Clear filters
            </button>
          </div>
        </div>

        {/* Agents table */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="py-20 text-center text-sm text-gray-400 dark:text-gray-500">Loading agents…</div>
          ) : agents.length === 0 ? (
            <div className="py-20 text-center text-sm text-gray-400 dark:text-gray-500">No agents found.</div>
          ) : filteredAgents.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-gray-400 dark:text-gray-500 text-sm">No agents match the current filters.</p>
              <button onClick={clearFilters} className="mt-3 text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium">
                Clear filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 text-left">
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Name</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Email</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Plan</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Trial/Plan Ends</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Last Active</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 text-right">Tickets</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredAgents.map((a) => {
                    const expired = isExpired(a)
                    return (
                      <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                          <div className="flex items-center gap-2">
                            <span>{a.full_name || "—"}</span>
                            {a.deactivated && <Badge label="Deactivated" className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" />}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{a.email}</td>
                        <td className="px-4 py-3">
                          <Badge
                            label={PLAN_LABELS[a.plan] ?? a.plan ?? "—"}
                            className={PLAN_BADGE_CLASSES[a.plan] ?? "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"}
                          />
                        </td>
                        <td className={`px-4 py-3 ${expired ? "text-red-600 dark:text-red-400 font-medium" : "text-gray-600 dark:text-gray-400"}`}>
                          {fmtDate(planExpiry(a))}
                          {expired && " (Expired)"}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{fmtDate(a.created_at)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{ticketCounts[a.id] ?? 0}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setManagingAgent(a)}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-400 font-medium transition-colors"
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ManageAgentModal
        isOpen={!!managingAgent}
        onClose={() => setManagingAgent(null)}
        agent={managingAgent}
        onUpdated={handleAgentUpdated}
      />
    </AdminLayout>
  )
}

function ManageAgentModal({ isOpen, onClose, agent, onUpdated }) {
  const [plan, setPlan] = useState("trial")
  const [planEndsAt, setPlanEndsAt] = useState("")
  const [deactivated, setDeactivated] = useState(false)
  const [trialEndsAt, setTrialEndsAt] = useState(null)
  const [saving, setSaving] = useState(false)
  const [extending, setExtending] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  useEffect(() => {
    if (isOpen && agent) {
      setPlan(agent.plan ?? "trial")
      setPlanEndsAt(fmtDateInput(agent.plan_ends_at))
      setDeactivated(agent.deactivated ?? false)
      setTrialEndsAt(agent.trial_ends_at)
      setError("")
      setSuccess("")
    }
  }, [isOpen, agent])

  if (!isOpen || !agent) return null

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleExtendTrial = async () => {
    setExtending(true)
    setError("")
    setSuccess("")

    const base = trialEndsAt && new Date(trialEndsAt) > new Date() ? new Date(trialEndsAt) : new Date()
    base.setDate(base.getDate() + 30)
    const next = base.toISOString()

    const { error } = await supabase.from("agents").update({ trial_ends_at: next }).eq("id", agent.id)

    setExtending(false)
    if (error) {
      setError(error.message)
      return
    }
    setTrialEndsAt(next)
    setSuccess("Trial extended by 30 days.")
    onUpdated({ id: agent.id, trial_ends_at: next })
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError("")
    setSuccess("")

    const updates = {
      plan,
      plan_ends_at: planEndsAt ? new Date(planEndsAt).toISOString() : null,
      deactivated,
    }

    const { error } = await supabase.from("agents").update(updates).eq("id", agent.id)

    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setSuccess("Agent updated.")
    onUpdated({ id: agent.id, ...updates })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 px-4 py-6" onMouseDown={handleBackdrop}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{agent.full_name || "Unnamed agent"}</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">{agent.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSave} className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          {error && (
            <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">{error}</div>
          )}
          {success && (
            <div className="px-4 py-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 rounded-lg text-sm">{success}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Plan</label>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="trial">Trial</option>
              <option value="monthly">Monthly</option>
              <option value="semi_annual">Semi-annual</option>
              <option value="annual">Annual</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Plan End Date</label>
            <input
              type="date"
              value={planEndsAt}
              onChange={(e) => setPlanEndsAt(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Trial Ends</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">{fmtDate(trialEndsAt)}</p>
            </div>
            <button
              type="button"
              onClick={handleExtendTrial}
              disabled={extending}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60 transition-colors"
            >
              {extending ? "Extending…" : "Extend Trial +30d"}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Deactivate account</span>
            <button
              type="button"
              role="switch"
              aria-checked={deactivated}
              onClick={() => setDeactivated((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                deactivated ? "bg-red-600" : "bg-gray-200 dark:bg-gray-700"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-gray-900 transition-transform ${
                  deactivated ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
