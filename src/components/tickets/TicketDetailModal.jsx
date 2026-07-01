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

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-gray-800 mt-0.5">{value ?? <span className="text-gray-300">—</span>}</p>
    </div>
  )
}

export default function TicketDetailModal({ isOpen, onClose, ticket, tickets, onNavigate }) {
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  useEffect(() => {
    if (!isOpen || !ticket) return
    fetchHistory()
  }, [isOpen, ticket])

  const fetchHistory = async () => {
    setLoadingHistory(true)
    const { data } = await supabase
      .from("ticket_payments")
      .select("id, allocated_amount, type, payments(id, amount, channel, trx_id, payment_date, type, notes)")
      .eq("ticket_id", ticket.id)
      .order("created_at", { ascending: false })
    setLoadingHistory(false)
    setHistory(data ?? [])
  }

  if (!isOpen || !ticket) return null

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const ticketMargin = (ticket.sell_price ?? 0) - (ticket.purchase_price ?? 0)
  const refundMargin =
    ticket.refund_received != null && ticket.refund_payable != null
      ? ticket.refund_received - ticket.refund_payable
      : null

  const parentTicket = ticket.parent_ticket_id
    ? tickets.find((t) => t.id === ticket.parent_ticket_id)
    : null
  const childTicket =
    ticket.status === "reissued"
      ? tickets.find((t) => t.parent_ticket_id === ticket.id)
      : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      onMouseDown={handleBackdrop}
    >
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Ticket details</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">
          {/* Chain info */}
          {(parentTicket || childTicket) && (
            <div className="flex flex-wrap gap-2">
              {parentTicket && (
                <button
                  onClick={() => onNavigate(parentTicket.id)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  ← View parent ticket ({parentTicket.passenger_name})
                </button>
              )}
              {childTicket && (
                <button
                  onClick={() => onNavigate(childTicket.id)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors"
                >
                  View reissued ticket ({childTicket.passenger_name}) →
                </button>
              )}
            </div>
          )}

          {/* Passenger & Travel */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Passenger & Travel</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Field label="Passenger" value={ticket.passenger_name} />
              <Field label="Carrier" value={ticket.carrier} />
              <Field label="PNR" value={ticket.pnr?.toUpperCase()} />
              <Field label="Ticket Number" value={ticket.ticket_number} />
              <Field label="Route" value={ticket.route} />
              <Field label="Issue Date" value={fmtDate(ticket.issue_date)} />
              <Field label="Travel Date" value={fmtDate(ticket.travel_date)} />
              <Field label="Return Date" value={fmtDate(ticket.return_date)} />
              <Field label="Status" value={ticket.status} />
            </div>
          </div>

          {/* Links */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Client & Supplier</h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Client" value={ticket.clients?.name} />
              <Field label="Supplier" value={ticket.suppliers?.name} />
            </div>
          </div>

          {/* Financials */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Financials</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Field label="Purchase Price" value={fmt(ticket.purchase_price)} />
              <Field label="Supplier Purchase Price" value={fmt(ticket.gds_price)} />
              <Field label="Office Markup" value={fmt(ticket.office_markup)} />
              <Field label="Sell Price" value={fmt(ticket.sell_price)} />
              <Field
                label="Ticket Margin"
                value={<span className={ticketMargin >= 0 ? "text-green-600" : "text-red-600"}>{fmt(ticketMargin)}</span>}
              />
              <Field label="Amount Paid" value={fmt(ticket.amount_paid)} />
              <Field label="Payment Status" value={ticket.payment_status} />
            </div>
          </div>

          {/* Reissue chain */}
          {ticket.is_reissue && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Reissue Details</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Field label="Reissue Fee Collected" value={fmt(ticket.reissue_fee_collected)} />
                <Field label="Reissue Fee Paid" value={fmt(ticket.reissue_fee_paid)} />
                <Field label="Fare Difference" value={fmt(ticket.fare_difference)} />
              </div>
            </div>
          )}

          {/* Refund details */}
          {ticket.refund_status && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Refund</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Field label="Refund Status" value={ticket.refund_status} />
                <Field label="Expected from Supplier" value={fmt(ticket.refund_receivable)} />
                <Field label="Received from Supplier" value={fmt(ticket.refund_received)} />
                <Field label="Agreed to pay Client" value={fmt(ticket.refund_payable)} />
                <Field label="Paid to Client" value={fmt(ticket.refund_paid)} />
                <Field
                  label="Refund Margin"
                  value={
                    refundMargin == null ? (
                      "—"
                    ) : (
                      <span className={refundMargin >= 0 ? "text-green-600" : "text-red-600"}>{fmt(refundMargin)}</span>
                    )
                  }
                />
              </div>
              {ticket.refund_notes && (
                <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap">{ticket.refund_notes}</p>
              )}
            </div>
          )}

          {/* Narration */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Notes</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {ticket.narration ?? <span className="text-gray-300">—</span>}
            </p>
          </div>

          {/* Payment history */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Payment History</h3>
            {loadingHistory ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-gray-400">No payments recorded for this ticket.</p>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs text-gray-500">
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Side</th>
                      <th className="px-3 py-2 font-medium">Channel</th>
                      <th className="px-3 py-2 font-medium">Trx ID</th>
                      <th className="px-3 py-2 font-medium text-right">Allocated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {history.map((row) => (
                      <tr key={row.id}>
                        <td className="px-3 py-2 text-gray-600">{fmtDate(row.payments?.payment_date)}</td>
                        <td className="px-3 py-2 text-gray-600 capitalize">{row.type}</td>
                        <td className="px-3 py-2 text-gray-600">{row.payments?.channel ?? "—"}</td>
                        <td className="px-3 py-2 text-gray-600">{row.payments?.trx_id ?? "—"}</td>
                        <td className="px-3 py-2 text-gray-600 text-right tabular-nums">{fmt(row.allocated_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
