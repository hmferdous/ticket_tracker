import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../../lib/supabase"
import { useAuth } from "../../../context/AuthContext"
import AppLayout from "../../../components/layout/AppLayout"

const CHANNELS = ["Cash", "bKash", "Bank", "Office", "EBL", "DBBL", "IBBL", "City", "BRAC", "UCB"]
const NO_CHANNEL = "No Channel"

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
      return { label: "Client Payment", cls: "bg-green-100 text-green-700" }
    case "supplier_payment":
      return { label: "Supplier Payment", cls: "bg-red-100 text-red-700" }
    case "client_refund":
      return { label: "Client Refund", cls: "bg-blue-100 text-blue-700" }
    case "supplier_refund":
      return { label: "Supplier Refund", cls: "bg-orange-100 text-orange-700" }
    default:
      return { label: type ?? "—", cls: "bg-gray-100 text-gray-600" }
  }
}

function isInflow(type) {
  return type === "client_payment" || type === "supplier_refund"
}

function PartyCell({ payment }) {
  const isClientSide = payment.type === "client_payment" || payment.type === "client_refund"
  const party = isClientSide ? payment.clients : payment.suppliers
  if (!party) return <span className="text-gray-300">—</span>
  const label = isClientSide ? clientIdLabel(party.client_id_number) : supplierIdLabel(party.supplier_id_number)
  const cls = isClientSide ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold tracking-wide ${cls}`}>{label}</span>
      <span className="text-gray-700">{party.name}</span>
    </div>
  )
}

function StatChip({ label, value, accent }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-full text-sm">
      <span className="text-gray-400 text-xs font-medium uppercase tracking-wide">{label}</span>
      <span className={`font-semibold tabular-nums ${accent ?? "text-gray-900"}`}>{fmt(value)}</span>
    </div>
  )
}

export default function ChannelLedger() {
  const { agent } = useAuth()

  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [selectedChannel, setSelectedChannel] = useState("")

  const fetchPayments = async () => {
    setLoading(true)
    setError("")
    const { data, error } = await supabase
      .from("payments")
      .select(`
        id, client_id, supplier_id, type, amount, channel, trx_id, notes, payment_date,
        clients(name, client_id_number),
        suppliers(name, supplier_id_number)
      `)
      .eq("agent_id", agent.id)
      .order("payment_date", { ascending: false })

    setLoading(false)
    if (error) setError(error.message)
    else setPayments(data ?? [])
  }

  useEffect(() => {
    if (agent?.id) fetchPayments()
  }, [agent])

  const channels = useMemo(() => {
    const hasNoChannel = payments.some((p) => !p.channel)
    return hasNoChannel ? [...CHANNELS, NO_CHANNEL] : CHANNELS
  }, [payments])

  const channelStats = useMemo(() => {
    const stats = {}
    for (const ch of channels) {
      stats[ch] = { openingBalance: 0, periodIn: 0, periodOut: 0, count: 0 }
    }
    for (const p of payments) {
      const ch = p.channel || NO_CHANNEL
      if (!stats[ch]) continue
      const amount = p.amount ?? 0
      const signed = isInflow(p.type) ? amount : -amount

      if (dateFrom && p.payment_date && p.payment_date < dateFrom) {
        stats[ch].openingBalance += signed
        continue
      }
      if (dateFrom && !p.payment_date) continue
      if (dateTo && p.payment_date && p.payment_date > dateTo) continue

      stats[ch].count += 1
      if (isInflow(p.type)) stats[ch].periodIn += amount
      else stats[ch].periodOut += amount
    }
    return stats
  }, [payments, channels, dateFrom, dateTo])

  const grandTotals = useMemo(() => {
    return Object.values(channelStats).reduce(
      (acc, s) => ({
        openingBalance: acc.openingBalance + s.openingBalance,
        periodIn: acc.periodIn + s.periodIn,
        periodOut: acc.periodOut + s.periodOut,
      }),
      { openingBalance: 0, periodIn: 0, periodOut: 0 }
    )
  }, [channelStats])

  const filteredEntries = useMemo(() => {
    return payments.filter((p) => {
      const ch = p.channel || NO_CHANNEL
      if (selectedChannel && ch !== selectedChannel) return false
      if (dateFrom && (!p.payment_date || p.payment_date < dateFrom)) return false
      if (dateTo && (!p.payment_date || p.payment_date > dateTo)) return false
      return true
    })
  }, [payments, selectedChannel, dateFrom, dateTo])

  const clearFilters = () => {
    setDateFrom("")
    setDateTo("")
    setSelectedChannel("")
  }

  const inputCls = "px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  return (
    <AppLayout title="Channel Ledger">
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Filter bar */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-36">
              <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`w-full ${inputCls}`} />
            </div>
            <div className="w-36">
              <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`w-full ${inputCls}`} />
            </div>
            <button
              onClick={clearFilters}
              className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Clear filters
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">Loading channel data…</div>
        ) : (
          <>
            {/* Grand totals */}
            <div className="flex flex-wrap gap-3 mb-4">
              <StatChip label="Total In" value={grandTotals.periodIn} accent="text-green-600" />
              <StatChip label="Total Out" value={grandTotals.periodOut} accent="text-red-600" />
              <StatChip
                label="Net Balance"
                value={grandTotals.openingBalance + grandTotals.periodIn - grandTotals.periodOut}
                accent={grandTotals.openingBalance + grandTotals.periodIn - grandTotals.periodOut >= 0 ? "text-green-600" : "text-red-600"}
              />
            </div>

            {/* Per-channel cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
              {channels.map((ch) => {
                const s = channelStats[ch]
                const balance = s.openingBalance + s.periodIn - s.periodOut
                const isSelected = selectedChannel === ch
                return (
                  <button
                    key={ch}
                    onClick={() => setSelectedChannel(isSelected ? "" : ch)}
                    className={`text-left bg-white border rounded-xl p-4 transition-colors ${
                      isSelected ? "border-blue-500 ring-2 ring-blue-100" : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">{ch}</p>
                    <p className={`text-lg font-semibold tabular-nums ${balance >= 0 ? "text-gray-900" : "text-red-600"}`}>
                      {fmt(balance)} BDT
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400">
                      <span className="text-green-600">+{fmt(s.periodIn)}</span>
                      <span className="text-red-600">-{fmt(s.periodOut)}</span>
                      <span>· {s.count} txn{s.count !== 1 ? "s" : ""}</span>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Drill-down transaction list */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                <span className="text-sm font-medium text-gray-600">
                  {selectedChannel ? `${selectedChannel} Transactions` : "All Transactions"}
                </span>
                <span className="text-xs text-gray-400">{filteredEntries.length} entries</span>
              </div>

              {filteredEntries.length === 0 ? (
                <div className="py-16 text-center text-sm text-gray-400">No transactions in this period.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-left">
                        <th className="px-4 py-3 font-medium text-gray-500">Date</th>
                        <th className="px-4 py-3 font-medium text-gray-500">Type</th>
                        <th className="px-4 py-3 font-medium text-gray-500">Party</th>
                        {!selectedChannel && <th className="px-4 py-3 font-medium text-gray-500">Channel</th>}
                        <th className="px-4 py-3 font-medium text-gray-500">Trx ID</th>
                        <th className="px-4 py-3 font-medium text-gray-500 text-right">Amount (BDT)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredEntries.map((p) => {
                        const badge = typeBadge(p.type)
                        const inflow = isInflow(p.type)
                        return (
                          <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(p.payment_date)}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.cls}`}>
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-4 py-3"><PartyCell payment={p} /></td>
                            {!selectedChannel && <td className="px-4 py-3 text-gray-600">{p.channel || NO_CHANNEL}</td>}
                            <td className="px-4 py-3 text-gray-500">{p.trx_id ?? "—"}</td>
                            <td className={`px-4 py-3 text-right tabular-nums font-medium ${inflow ? "text-green-600" : "text-red-600"}`}>
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
    </AppLayout>
  )
}
