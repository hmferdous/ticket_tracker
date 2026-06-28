import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"

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

export default function ViewPaymentModal({ isOpen, onClose, payment }) {
  const [allocations, setAllocations] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (isOpen && payment) {
      fetchAllocations()
    } else {
      setAllocations([])
      setError("")
    }
  }, [isOpen, payment])

  const fetchAllocations = async () => {
    setLoading(true)
    setError("")
    const { data, error } = await supabase
      .from("ticket_payments")
      .select("id, allocated_amount, tickets(id, passenger_name, route)")
      .eq("payment_id", payment.id)

    setLoading(false)
    if (error) setError(error.message)
    else setAllocations(data ?? [])
  }

  if (!isOpen || !payment) return null

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const badge = typeBadge(payment.type)
  const isClientSide = payment.type === "client_payment" || payment.type === "client_refund"
  const party = isClientSide ? payment.clients : payment.suppliers
  const partyLabel = isClientSide
    ? clientIdLabel(party?.client_id_number)
    : supplierIdLabel(party?.supplier_id_number)
  const partyBadgeCls = isClientSide ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6" onMouseDown={handleBackdrop}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Payment Details</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-400 text-xs mb-1">Date</p>
              <p className="text-gray-800">{fmtDate(payment.payment_date)}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1">Type</p>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.cls}`}>
                {badge.label}
              </span>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1">Party</p>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold tracking-wide ${partyBadgeCls}`}>
                  {partyLabel}
                </span>
                <span className="text-gray-800">{party?.name ?? "—"}</span>
              </div>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1">Amount</p>
              <p className="text-gray-800 tabular-nums">{fmt(payment.amount)} BDT</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1">Channel</p>
              <p className="text-gray-800">{payment.channel ?? "—"}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1">Trx ID</p>
              <p className="text-gray-800">{payment.trx_id ?? "—"}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1">Unallocated</p>
              <p className={`tabular-nums ${(payment.unallocated_amount ?? 0) > 0 ? "text-yellow-600 font-medium" : "text-gray-800"}`}>
                {fmt(payment.unallocated_amount)} BDT
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-gray-400 text-xs mb-1">Notes</p>
              <p className="text-gray-800">{payment.notes || "—"}</p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Allocated to Tickets</h3>
            {loading ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : allocations.length === 0 ? (
              <p className="text-sm text-gray-400">No tickets allocated from this payment yet.</p>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs text-gray-500">
                      <th className="px-3 py-2 font-medium">Passenger</th>
                      <th className="px-3 py-2 font-medium">Route</th>
                      <th className="px-3 py-2 font-medium text-right">Allocated Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {allocations.map((a) => (
                      <tr key={a.id}>
                        <td className="px-3 py-2 text-gray-700">{a.tickets?.passenger_name ?? "—"}</td>
                        <td className="px-3 py-2 text-gray-600">{a.tickets?.route ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-blue-700">{fmt(a.allocated_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
