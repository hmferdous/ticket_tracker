import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { supabase } from "../../../lib/supabase"
import { useAuth } from "../../../context/AuthContext"
import { generateLedgerPdf } from "../../../lib/generateLedgerPdf"
import AppLayout from "../../../components/layout/AppLayout"

function fmt(n) {
  if (n == null) return "—"
  return Number(n).toLocaleString("en-BD")
}

function fmtDate(d) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function SummaryCard({ label, value, accent }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${accent ?? "text-gray-900 dark:text-gray-100"}`}>{value}</p>
    </div>
  )
}

function typeBadge(type) {
  switch (type) {
    case "invoice":   return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
    case "payment":   return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
    case "refund":    return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
    default:          return "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
  }
}

function buildDescription(payment) {
  const fullyUnallocated = (payment.unallocated_amount ?? 0) >= (payment.amount ?? 0)
  const isRefund = payment.type === "client_refund"
  if (fullyUnallocated) return isRefund ? "Unallocated Refund" : "Unallocated Payment"
  if (payment.trx_id) return `${isRefund ? "Refund" : "Payment"} — ${payment.trx_id}`
  return isRefund ? "Client Refund" : "Client Payment"
}

export default function ClientLedger() {
  const { agent } = useAuth()
  const [searchParams] = useSearchParams()

  const [clients, setClients] = useState([])
  const [clientsLoaded, setClientsLoaded] = useState(false)
  const [clientId, setClientId] = useState(searchParams.get("clientId") ?? "")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const [tickets, setTickets] = useState([])
  const [payments, setPayments] = useState([])
  const [generated, setGenerated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [error, setError] = useState("")

  // Load clients, then auto-generate if clientId came from URL
  useEffect(() => {
    if (!agent?.id) return
    supabase
      .from("clients")
      .select("id, name, client_id_number")
      .eq("agent_id", agent.id)
      .order("name")
      .then(({ data }) => {
        setClients(data ?? [])
        setClientsLoaded(true)
      })
  }, [agent?.id])

  const prefilledId = searchParams.get("clientId")
  useEffect(() => {
    if (clientsLoaded && prefilledId && clientId === prefilledId) {
      handleGenerate()
    }
  }, [clientsLoaded, prefilledId])

  const selectedClient = clients.find((c) => c.id === clientId)

  const handleGenerate = async () => {
    if (!clientId) { setError("Select a client first"); return }
    setError("")
    setLoading(true)
    setGenerated(false)

    const [ticketRes, paymentRes] = await Promise.all([
      supabase
        .from("tickets")
        .select("id, passenger_name, route, issue_date, sell_price, amount_paid, payment_status, is_void")
        .eq("agent_id", agent.id)
        .eq("client_id", clientId),
      supabase
        .from("payments")
        .select("id, type, amount, unallocated_amount, payment_date, trx_id, notes")
        .eq("agent_id", agent.id)
        .eq("client_id", clientId),
    ])

    setLoading(false)

    if (ticketRes.error) { setError(ticketRes.error.message); return }
    if (paymentRes.error) { setError(paymentRes.error.message); return }

    setTickets(ticketRes.data ?? [])
    setPayments(paymentRes.data ?? [])
    setGenerated(true)
  }

  // Opening balance: everything strictly before dateFrom
  const openingBalance = useMemo(() => {
    if (!generated || !dateFrom) return null
    const nonVoidTickets = tickets.filter((t) => !t.is_void && t.issue_date && t.issue_date < dateFrom)
    const invoiced = nonVoidTickets.reduce((s, t) => s + (t.sell_price ?? 0), 0)
    const received = payments
      .filter((p) => p.type === "client_payment" && p.payment_date && p.payment_date < dateFrom)
      .reduce((s, p) => s + (p.amount ?? 0), 0)
    const refunded = payments
      .filter((p) => p.type === "client_refund" && p.payment_date && p.payment_date < dateFrom)
      .reduce((s, p) => s + (p.amount ?? 0), 0)
    return invoiced - received + refunded
  }, [generated, dateFrom, tickets, payments])

  // Period entries
  const periodEntries = useMemo(() => {
    if (!generated) return []
    const entries = []

    // Ticket entries (debit)
    for (const t of tickets) {
      if (t.is_void) continue
      if (!t.issue_date) continue
      if (dateFrom && t.issue_date < dateFrom) continue
      if (dateTo && t.issue_date > dateTo) continue
      entries.push({
        _sort: t.issue_date,
        date: t.issue_date,
        type: "invoice",
        description: `${t.passenger_name ?? ""}${t.route ? ` — ${t.route}` : ""}`,
        refIssueDate: null,
        debit: t.sell_price ?? 0,
        credit: null,
      })
    }

    // Payment / refund entries
    for (const p of payments) {
      const inPeriod =
        (!dateFrom || (p.payment_date && p.payment_date >= dateFrom)) &&
        (!dateTo || (p.payment_date && p.payment_date <= dateTo))
      if (!inPeriod) continue

      if (p.type === "client_payment") {
        entries.push({
          _sort: p.payment_date,
          date: p.payment_date,
          type: "payment",
          description: buildDescription(p),
          refIssueDate: null,
          debit: null,
          credit: p.amount ?? 0,
          trxId: p.trx_id,
        })
      } else if (p.type === "client_refund") {
        entries.push({
          _sort: p.payment_date,
          date: p.payment_date,
          type: "refund",
          description: buildDescription(p),
          refIssueDate: null,
          debit: p.amount ?? 0,
          credit: null,
          trxId: p.trx_id,
        })
      }
    }

    // Descending for portal
    return entries.sort((a, b) => (b._sort ?? "").localeCompare(a._sort ?? ""))
  }, [generated, tickets, payments, dateFrom, dateTo])

  // Summary totals (period)
  const summary = useMemo(() => {
    const totalInvoiced = periodEntries.filter((e) => e.type === "invoice").reduce((s, e) => s + (e.debit ?? 0), 0)
    const totalReceived = periodEntries.filter((e) => e.type === "payment").reduce((s, e) => s + (e.credit ?? 0), 0)
    const totalRefunded = periodEntries.filter((e) => e.type === "refund").reduce((s, e) => s + (e.debit ?? 0), 0)
    const netDue = (openingBalance ?? 0) + totalInvoiced - totalReceived + totalRefunded
    const unallocated = payments
      .filter((p) => p.type === "client_payment")
      .reduce((s, p) => s + (p.unallocated_amount ?? 0), 0)
    return { totalInvoiced, totalReceived, totalRefunded, netDue, unallocated }
  }, [periodEntries, openingBalance, payments])

  const handleDownloadPdf = () => {
    setPdfLoading(true)
    setTimeout(() => {
      try {
        generateLedgerPdf({
          entityType: "client",
          entityName: selectedClient?.name ?? "Client",
          entityIdLabel: selectedClient?.client_id_number
            ? `C-${String(selectedClient.client_id_number).padStart(3, "0")}`
            : "—",
          agentEmail: agent?.email ?? "",
          dateFrom,
          dateTo,
          openingBalance,
          entries: periodEntries,
          summary,
          isClient: true,
        })
      } finally {
        setPdfLoading(false)
      }
    }, 0)
  }

  const inputCls = "px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"

  return (
    <AppLayout title="Client Ledger">
      <div className="max-w-screen-xl mx-auto px-6 py-8">

        {/* Controls */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 mb-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-64">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Client</label>
              <select
                value={clientId}
                onChange={(e) => { setClientId(e.target.value); setGenerated(false) }}
                className={`w-full ${inputCls}`}
              >
                <option value="">— Select client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.client_id_number ? `C-${String(c.client_id_number).padStart(3, "0")} ` : ""}{c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From</label>
              <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setGenerated(false) }} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To</label>
              <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setGenerated(false) }} className={inputCls} />
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading || !clientId}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {loading ? "Loading…" : "Generate"}
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        {generated && (
          <>
            {/* Entity header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {selectedClient?.name ?? "Client"}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Statement of Account
                  {dateFrom || dateTo
                    ? ` · ${dateFrom ? fmtDate(dateFrom) : "—"} to ${dateTo ? fmtDate(dateTo) : "—"}`
                    : " · All time"}
                </p>
              </div>
              <button
                onClick={handleDownloadPdf}
                disabled={pdfLoading}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {pdfLoading ? "Generating…" : "↓ Download PDF"}
              </button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
              <SummaryCard label="Total Invoiced" value={`${fmt(summary.totalInvoiced)} BDT`} />
              <SummaryCard label="Total Received" value={`${fmt(summary.totalReceived)} BDT`} accent="text-green-600 dark:text-green-400" />
              <SummaryCard label="Total Refunded" value={`${fmt(summary.totalRefunded)} BDT`} accent="text-red-600 dark:text-red-400" />
              <SummaryCard
                label="Net Due"
                value={`${fmt(summary.netDue)} BDT`}
                accent={summary.netDue > 0 ? "text-yellow-600 dark:text-yellow-400" : "text-green-600 dark:text-green-400"}
              />
              <SummaryCard label="Unallocated Credit" value={`${fmt(summary.unallocated)} BDT`} accent="text-blue-600 dark:text-blue-400" />
            </div>

            {/* Ledger table */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
              {openingBalance !== null && (
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-800">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Opening Balance</span>
                  <span className={`text-sm font-semibold tabular-nums ${openingBalance > 0 ? "text-yellow-600 dark:text-yellow-400" : openingBalance < 0 ? "text-green-600 dark:text-green-400" : "text-gray-500 dark:text-gray-400"}`}>
                    {fmt(Math.abs(openingBalance))} BDT {openingBalance > 0 ? "Dr" : openingBalance < 0 ? "Cr" : ""}
                  </span>
                </div>
              )}

              {periodEntries.length === 0 ? (
                <div className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">No transactions in this period.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 text-left">
                        <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Date</th>
                        <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Type</th>
                        <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Description</th>
                        <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Ref. Issue Date</th>
                        <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Trx ID</th>
                        <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 text-right">Debit (BDT)</th>
                        <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 text-right">Credit (BDT)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {periodEntries.map((entry, i) => (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{fmtDate(entry.date)}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${typeBadge(entry.type)}`}>
                              {entry.type === "invoice" ? "Invoice" : entry.type === "payment" ? "Payment" : "Refund"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{entry.description}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtDate(entry.refIssueDate)}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{entry.trxId ?? <span className="text-gray-200 dark:text-gray-700">—</span>}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-red-600 dark:text-red-400 font-medium">
                            {entry.debit != null ? fmt(entry.debit) : <span className="text-gray-200 dark:text-gray-700">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-green-600 dark:text-green-400 font-medium">
                            {entry.credit != null ? fmt(entry.credit) : <span className="text-gray-200 dark:text-gray-700">—</span>}
                          </td>
                        </tr>
                      ))}
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
