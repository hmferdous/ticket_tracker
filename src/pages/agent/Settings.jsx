import { useEffect, useState } from "react"
import * as XLSX from "xlsx"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../context/AuthContext"
import AppLayout from "../../components/layout/AppLayout"
import { ThemeToggleFull } from "../../components/ui/ThemeToggle"

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

function fmtDate(d) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function flattenWithParties(rows) {
  return (rows ?? []).map((row) => {
    const { clients, suppliers, ...rest } = row
    return { ...rest, client_name: clients?.name ?? "", supplier_name: suppliers?.name ?? "" }
  })
}

export default function Settings() {
  const { user, agent } = useAuth()

  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState("")
  const [profileSuccess, setProfileSuccess] = useState("")

  const [reminderEnabled, setReminderEnabled] = useState(true)
  const [reminderDaysClient, setReminderDaysClient] = useState(3)
  const [reminderDaysSupplier, setReminderDaysSupplier] = useState(5)
  const [reminderHour, setReminderHour] = useState(9)
  const [reminderSaving, setReminderSaving] = useState(false)
  const [reminderError, setReminderError] = useState("")
  const [reminderSuccess, setReminderSuccess] = useState("")

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState("")

  useEffect(() => {
    if (!agent) return
    setFullName(agent.full_name ?? "")
    setPhone(agent.phone ?? "")
    setReminderEnabled(agent.reminder_enabled ?? true)
    setReminderDaysClient(agent.reminder_days_client ?? 3)
    setReminderDaysSupplier(agent.reminder_days_supplier ?? 5)
    setReminderHour(agent.reminder_hour ?? 9)
  }, [agent])

  if (!agent) {
    return (
      <AppLayout title="Settings">
        <div className="px-6 py-10 text-sm text-gray-400 dark:text-gray-500">Loading…</div>
      </AppLayout>
    )
  }

  const handleSaveProfile = async (e) => {
    e.preventDefault()
    setProfileSaving(true)
    setProfileError("")
    setProfileSuccess("")

    const { error } = await supabase
      .from("agents")
      .update({ full_name: fullName.trim() || null, phone: phone.trim() || null })
      .eq("id", agent.id)

    setProfileSaving(false)
    if (error) setProfileError(error.message)
    else setProfileSuccess("Profile saved.")
  }

  const handleSaveReminders = async (e) => {
    e.preventDefault()
    setReminderSaving(true)
    setReminderError("")
    setReminderSuccess("")

    const { error } = await supabase
      .from("agents")
      .update({
        reminder_enabled: reminderEnabled,
        reminder_days_client: Number(reminderDaysClient) || 0,
        reminder_days_supplier: Number(reminderDaysSupplier) || 0,
        reminder_hour: Number(reminderHour),
      })
      .eq("id", agent.id)

    setReminderSaving(false)
    if (error) setReminderError(error.message)
    else setReminderSuccess("Reminder preferences saved.")
  }

  const handleExport = async () => {
    setExporting(true)
    setExportError("")

    try {
      const [ticketsRes, clientsRes, suppliersRes, paymentsRes] = await Promise.all([
        supabase
          .from("tickets")
          .select("*, clients(name), suppliers(name)")
          .eq("agent_id", agent.id)
          .order("created_at", { ascending: false }),
        supabase.from("clients").select("*").eq("agent_id", agent.id).order("client_id_number"),
        supabase.from("suppliers").select("*").eq("agent_id", agent.id).order("supplier_id_number"),
        supabase
          .from("payments")
          .select("*, clients(name), suppliers(name)")
          .eq("agent_id", agent.id)
          .order("payment_date", { ascending: false }),
      ])

      for (const res of [ticketsRes, clientsRes, suppliersRes, paymentsRes]) {
        if (res.error) throw res.error
      }

      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(flattenWithParties(ticketsRes.data)), "Tickets")
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(clientsRes.data ?? []), "Clients")
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(suppliersRes.data ?? []), "Suppliers")
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(flattenWithParties(paymentsRes.data)), "Payments")

      const dateStr = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(workbook, `ticket-tracker-export-${dateStr}.xlsx`)
    } catch (err) {
      setExportError(err.message ?? "Export failed.")
    } finally {
      setExporting(false)
    }
  }

  const planKey = agent.plan ?? "trial"
  const planLabel = PLAN_LABELS[planKey] ?? planKey
  const planBadgeCls = PLAN_BADGE_CLASSES[planKey] ?? "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
  const expiryDate = planKey === "trial" ? agent.trial_ends_at : agent.plan_ends_at
  const expiryLabel = planKey === "trial" ? "Trial ends" : "Plan ends"

  return (
    <AppLayout title="Settings">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* Profile */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Profile</h2>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${planBadgeCls}`}>
                {planLabel}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {expiryLabel} {fmtDate(expiryDate)}
              </span>
            </div>
          </div>

          {profileError && (
            <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">{profileError}</div>
          )}
          {profileSuccess && (
            <div className="mb-4 px-4 py-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 rounded-lg text-sm">{profileSuccess}</div>
          )}

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01XXXXXXXXX"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
              <input
                type="email"
                value={user?.email ?? ""}
                disabled
                readOnly
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-lg text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={profileSaving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {profileSaving ? "Saving…" : "Save"}
            </button>
          </form>
        </section>

        {/* Appearance */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Appearance</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Choose how Ticket Tracker looks on this device.</p>
          <ThemeToggleFull />
        </section>

        {/* Reminder Preferences */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Reminder Preferences</h2>

          {reminderError && (
            <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">{reminderError}</div>
          )}
          {reminderSuccess && (
            <div className="mb-4 px-4 py-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 rounded-lg text-sm">{reminderSuccess}</div>
          )}

          <form onSubmit={handleSaveReminders} className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Enable email reminders</span>
              <button
                type="button"
                role="switch"
                aria-checked={reminderEnabled}
                onClick={() => setReminderEnabled((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  reminderEnabled ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-700"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-gray-900 transition-transform ${
                    reminderEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {reminderEnabled && (
              <div className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Days before flight — client payment reminder
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={reminderDaysClient}
                      onChange={(e) => setReminderDaysClient(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Days before flight — supplier payment reminder
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={reminderDaysSupplier}
                      onChange={(e) => setReminderDaysSupplier(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <div className="sm:w-1/2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Send reminders at (Bangladesh time)
                  </label>
                  <select
                    value={reminderHour}
                    onChange={(e) => setReminderHour(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {Array.from({ length: 24 }, (_, h) => {
                      const label = h === 0 ? "12:00 AM" : h < 12 ? `${h}:00 AM` : h === 12 ? "12:00 PM" : `${h - 12}:00 PM`
                      return <option key={h} value={h}>{label}</option>
                    })}
                  </select>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={reminderSaving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {reminderSaving ? "Saving…" : "Save"}
            </button>
          </form>
        </section>

        {/* Data */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">Data</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Export all your tickets, clients, suppliers, and payments to an Excel workbook.
          </p>

          {exportError && (
            <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">{exportError}</div>
          )}

          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {exporting ? "Exporting…" : "Export All Data"}
          </button>
        </section>
      </div>
    </AppLayout>
  )
}
