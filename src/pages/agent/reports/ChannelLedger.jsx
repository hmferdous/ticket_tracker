import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../../lib/supabase"
import { useAuth } from "../../../context/AuthContext"
import AppLayout from "../../../components/layout/AppLayout"
import ChannelModal from "../../../components/payments/ChannelModal"
import { fetchChannels } from "../../../lib/channels"

const NO_CHANNEL_KEY = "__no_channel__"
const NO_CHANNEL_LABEL = "No Channel"

function fmt(n) {
  if (n == null) return "—"
  return Number(n).toLocaleString("en-BD")
}

function fmtDate(d) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function clientIdLabel(num) {
  if (num == null) return "—"
  return `C-${String(num).padStart(3, "0")}`
}

function supplierIdLabel(num) {
  if (num == null) return "—"
  return `S-${String(num).padStart(3, "0")}`
}

function typeBadge(type) {
  switch (type) {
    case "client_payment":
      return { label: "Client Payment", cls: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" }
    case "supplier_payment":
      return { label: "Supplier Payment", cls: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" }
    case "client_refund":
      return { label: "Client Refund", cls: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400" }
    case "supplier_refund":
      return { label: "Supplier Refund", cls: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400" }
    default:
      return { label: type ?? "—", cls: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400" }
  }
}

function isInflow(type) {
  return type === "client_payment" || type === "supplier_refund"
}

function PartyCell({ payment }) {
  const isClientSide = payment.type === "client_payment" || payment.type === "client_refund"
  const party = isClientSide ? payment.clients : payment.suppliers
  if (!party) return <span className="text-gray-300 dark:text-gray-600">—</span>
  const label = isClientSide ? clientIdLabel(party.client_id_number) : supplierIdLabel(party.supplier_id_number)
  const cls = isClientSide ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" : "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400"
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold tracking-wide ${cls}`}>{label}</span>
      <span className="text-gray-700 dark:text-gray-300">{party.name}</span>
    </div>
  )
}

function StatChip({ label, value, accent }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-full text-sm">
      <span className="text-gray-400 dark:text-gray-500 text-xs font-medium uppercase tracking-wide">{label}</span>
      <span className={`font-semibold tabular-nums ${accent ?? "text-gray-900 dark:text-gray-100"}`}>{fmt(value)}</span>
    </div>
  )
}

function RowActionsMenu({ items, isOpen, onToggle, onClose }) {
  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        className="p-1 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-label="Channel actions"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); onClose() }} />
          <div className="absolute right-0 top-full z-20 mt-1 w-36 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-100 dark:border-gray-800 py-1">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={(e) => { e.stopPropagation(); onClose(); item.onClick() }}
                className={`block w-full text-left px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${item.cls}`}
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

function ChannelCard({ channel, balance, stats, isSelected, isMenuOpen, onSelect, onToggleMenu, onCloseMenu, onEdit, onToggleArchive }) {
  const menuItems = channel
    ? [
        { key: "edit", label: "Edit", cls: "text-gray-700 dark:text-gray-300", onClick: onEdit },
        {
          key: "archive",
          label: channel.is_active ? "Archive" : "Restore",
          cls: channel.is_active ? "text-red-500 dark:text-red-400" : "text-green-600 dark:text-green-400",
          onClick: onToggleArchive,
        },
      ]
    : []

  return (
    <div
      className={`relative text-left bg-white dark:bg-gray-900 border rounded-xl p-4 transition-colors ${
        isSelected ? "border-blue-500 ring-2 ring-blue-100" : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700"
      } ${channel && !channel.is_active ? "opacity-60" : ""}`}
    >
      {channel && (
        <div className="absolute top-2 right-2">
          <RowActionsMenu items={menuItems} isOpen={isMenuOpen} onToggle={onToggleMenu} onClose={onCloseMenu} />
        </div>
      )}
      <button onClick={onSelect} className="w-full text-left">
        <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1 pr-6">
          {channel ? channel.name : NO_CHANNEL_LABEL}
        </p>
        <p className={`text-lg font-semibold tabular-nums ${balance >= 0 ? "text-gray-900 dark:text-gray-100" : "text-red-600 dark:text-red-400"}`}>
          {fmt(balance)} BDT
        </p>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400 dark:text-gray-500">
          <span className="text-green-600 dark:text-green-400">+{fmt(stats.periodIn)}</span>
          <span className="text-red-600 dark:text-red-400">-{fmt(stats.periodOut)}</span>
          <span>· {stats.count} txn{stats.count !== 1 ? "s" : ""}</span>
        </div>
      </button>
    </div>
  )
}

export default function ChannelLedger() {
  const { agent } = useAuth()

  const [payments, setPayments] = useState([])
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [selectedChannel, setSelectedChannel] = useState("")
  const [showArchived, setShowArchived] = useState(false)

  const [openMenuId, setOpenMenuId] = useState(null)
  const [channelModal, setChannelModal] = useState(null) // { channel: null | object }

  const fetchAll = async () => {
    setLoading(true)
    setError("")
    const [paymentsRes, channelsRes] = await Promise.all([
      supabase
        .from("payments")
        .select(`
          id, client_id, supplier_id, type, amount, channel, channel_id, trx_id, notes, payment_date,
          clients(name, client_id_number),
          suppliers(name, supplier_id_number)
        `)
        .eq("agent_id", agent.id)
        .order("payment_date", { ascending: false }),
      fetchChannels(agent.id, { includeArchived: true }),
    ])

    setLoading(false)
    const firstErr = paymentsRes.error || channelsRes.error
    if (firstErr) { setError(firstErr.message); return }
    setPayments(paymentsRes.data ?? [])
    setChannels(channelsRes.data ?? [])
  }

  useEffect(() => {
    if (agent?.id) fetchAll()
  }, [agent])

  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels])
  const channelByName = useMemo(() => new Map(channels.map((c) => [c.name.toLowerCase(), c])), [channels])

  const resolveChannel = (payment) => {
    if (payment.channel_id && channelById.has(payment.channel_id)) return channelById.get(payment.channel_id)
    if (payment.channel) return channelByName.get(payment.channel.toLowerCase()) ?? null
    return null
  }

  const channelStats = useMemo(() => {
    const stats = new Map()
    for (const c of channels) stats.set(c.id, { openingBalance: 0, periodIn: 0, periodOut: 0, count: 0 })
    stats.set(NO_CHANNEL_KEY, { openingBalance: 0, periodIn: 0, periodOut: 0, count: 0 })

    for (const p of payments) {
      const c = resolveChannel(p)
      const bucket = stats.get(c ? c.id : NO_CHANNEL_KEY)
      if (!bucket) continue
      const amount = p.amount ?? 0
      const signed = isInflow(p.type) ? amount : -amount

      if (dateFrom && p.payment_date && p.payment_date < dateFrom) {
        bucket.openingBalance += signed
        continue
      }
      if (dateFrom && !p.payment_date) continue
      if (dateTo && p.payment_date && p.payment_date > dateTo) continue

      bucket.count += 1
      if (isInflow(p.type)) bucket.periodIn += amount
      else bucket.periodOut += amount
    }
    return stats
  }, [payments, channels, dateFrom, dateTo]) // eslint-disable-line react-hooks/exhaustive-deps

  const balanceFor = (channel) => {
    const s = channelStats.get(channel ? channel.id : NO_CHANNEL_KEY) ?? { openingBalance: 0, periodIn: 0, periodOut: 0, count: 0 }
    return (channel?.starting_balance ?? 0) + s.openingBalance + s.periodIn - s.periodOut
  }

  const grandTotals = useMemo(() => {
    let startingBalance = 0
    let openingBalance = 0
    let periodIn = 0
    let periodOut = 0
    for (const [, s] of channelStats) {
      openingBalance += s.openingBalance
      periodIn += s.periodIn
      periodOut += s.periodOut
    }
    for (const c of channels) startingBalance += c.starting_balance ?? 0
    return { startingBalance, openingBalance, periodIn, periodOut }
  }, [channelStats, channels])

  const filteredEntries = useMemo(() => {
    return payments.filter((p) => {
      if (selectedChannel) {
        const c = resolveChannel(p)
        const key = c ? c.id : NO_CHANNEL_KEY
        if (key !== selectedChannel) return false
      }
      if (dateFrom && (!p.payment_date || p.payment_date < dateFrom)) return false
      if (dateTo && (!p.payment_date || p.payment_date > dateTo)) return false
      return true
    })
  }, [payments, selectedChannel, dateFrom, dateTo]) // eslint-disable-line react-hooks/exhaustive-deps

  const clearFilters = () => {
    setDateFrom("")
    setDateTo("")
    setSelectedChannel("")
  }

  const toggleArchive = async (channel) => {
    const { data, error } = await supabase
      .from("payment_channels")
      .update({ is_active: !channel.is_active })
      .eq("id", channel.id)
      .select()
      .single()
    if (error) { setError(error.message); return }
    setChannels((prev) => prev.map((c) => (c.id === channel.id ? data : c)))
  }

  const handleChannelSaved = (saved) => {
    setChannels((prev) => {
      const exists = prev.find((c) => c.id === saved.id)
      return exists ? prev.map((c) => (c.id === saved.id ? saved : c)) : [...prev, saved]
    })
  }

  const activeChannels = channels.filter((c) => c.is_active)
  const archivedChannels = channels.filter((c) => !c.is_active)

  const inputCls = "px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  const selectedLabel = selectedChannel
    ? selectedChannel === NO_CHANNEL_KEY
      ? NO_CHANNEL_LABEL
      : channelById.get(selectedChannel)?.name ?? "Channel"
    : null

  const renderChannelCard = (channel) => {
    const key = channel ? channel.id : NO_CHANNEL_KEY
    const stats = channelStats.get(key) ?? { periodIn: 0, periodOut: 0, count: 0 }
    return (
      <ChannelCard
        key={key}
        channel={channel}
        balance={balanceFor(channel)}
        stats={stats}
        isSelected={selectedChannel === key}
        isMenuOpen={channel ? openMenuId === channel.id : false}
        onSelect={() => setSelectedChannel(selectedChannel === key ? "" : key)}
        onToggleMenu={() => channel && setOpenMenuId((prev) => (prev === channel.id ? null : channel.id))}
        onCloseMenu={() => setOpenMenuId(null)}
        onEdit={() => setChannelModal({ channel })}
        onToggleArchive={() => channel && toggleArchive(channel)}
      />
    )
  }

  return (
    <AppLayout
      title="Channel Ledger"
      actions={
        <button
          onClick={() => setChannelModal({ channel: null })}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + Add Channel
        </button>
      }
    >
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Filter bar */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-36">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`w-full ${inputCls}`} />
            </div>
            <div className="w-36">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`w-full ${inputCls}`} />
            </div>
            <button
              onClick={clearFilters}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Clear filters
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400 dark:text-gray-500">Loading channel data…</div>
        ) : (
          <>
            {/* Grand totals */}
            <div className="flex flex-wrap gap-3 mb-4">
              <StatChip label="Total In" value={grandTotals.periodIn} accent="text-green-600 dark:text-green-400" />
              <StatChip label="Total Out" value={grandTotals.periodOut} accent="text-red-600 dark:text-red-400" />
              <StatChip
                label="Net Balance"
                value={grandTotals.startingBalance + grandTotals.openingBalance + grandTotals.periodIn - grandTotals.periodOut}
                accent={
                  grandTotals.startingBalance + grandTotals.openingBalance + grandTotals.periodIn - grandTotals.periodOut >= 0
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }
              />
            </div>

            {/* Per-channel cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-3">
              {activeChannels.map((c) => renderChannelCard(c))}
              {renderChannelCard(null)}
            </div>

            {archivedChannels.length > 0 && (
              <div className="mb-6">
                <button
                  onClick={() => setShowArchived((v) => !v)}
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
                >
                  {showArchived ? "Hide" : "Show"} archived channels ({archivedChannels.length})
                </button>
                {showArchived && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-3">
                    {archivedChannels.map((c) => renderChannelCard(c))}
                  </div>
                )}
              </div>
            )}

            {/* Drill-down transaction list */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-800">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  {selectedLabel ? `${selectedLabel} Transactions` : "All Transactions"}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">{filteredEntries.length} entries</span>
              </div>

              {filteredEntries.length === 0 ? (
                <div className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">No transactions in this period.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 text-left">
                        <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Date</th>
                        <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Type</th>
                        <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Party</th>
                        {!selectedChannel && <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Channel</th>}
                        <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Trx ID</th>
                        <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 text-right">Amount (BDT)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {filteredEntries.map((p) => {
                        const badge = typeBadge(p.type)
                        const inflow = isInflow(p.type)
                        const c = resolveChannel(p)
                        return (
                          <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                            <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{fmtDate(p.payment_date)}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.cls}`}>
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-4 py-3"><PartyCell payment={p} /></td>
                            {!selectedChannel && <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{c?.name ?? NO_CHANNEL_LABEL}</td>}
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{p.trx_id ?? "—"}</td>
                            <td className={`px-4 py-3 text-right tabular-nums font-medium ${inflow ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                              {inflow ? "+" : "-"}{fmt(p.amount)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <ChannelModal
        isOpen={!!channelModal}
        onClose={() => setChannelModal(null)}
        agentId={agent?.id}
        channel={channelModal?.channel ?? null}
        existingChannels={channels}
        onSaved={handleChannelSaved}
      />
    </AppLayout>
  )
}
