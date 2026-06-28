import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

function fmt(n) {
  if (n == null) return "—"
  return Number(n).toLocaleString("en-BD")
}

function fmtDate(d) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

const BLUE    = [30, 64, 175]
const LIGHT   = [249, 250, 251]
const DARK    = [17, 24, 39]
const MID     = [107, 114, 128]
const WHITE   = [255, 255, 255]

// entries should be in DESCENDING order (portal order) — this function reverses to ascending for PDF
export function generateLedgerPdf({
  entityType,       // 'client' | 'supplier'
  entityName,
  entityIdLabel,    // 'C-001' | 'S-001'
  agentEmail,
  dateFrom,
  dateTo,
  openingBalance,
  entries,          // descending — reversed here
  summary,
  isClient,
}) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const M = 14   // margin
  const W = pageW - M * 2

  // ── Top header bar ─────────────────────────────────────────────────
  doc.setFillColor(...BLUE)
  doc.rect(0, 0, pageW, 26, "F")

  doc.setTextColor(...WHITE)
  doc.setFontSize(13)
  doc.setFont("helvetica", "bold")
  doc.text("TICKET TRACKER", M, 11)

  doc.setFontSize(8)
  doc.setFont("helvetica", "normal")
  doc.text(agentEmail ?? "", M, 18)

  doc.setFontSize(11)
  doc.setFont("helvetica", "bold")
  doc.text("Statement of Account", pageW - M, 10, { align: "right" })

  doc.setFontSize(7.5)
  doc.setFont("helvetica", "normal")
  const periodLabel =
    dateFrom || dateTo
      ? `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`
      : "All time"
  doc.text(`Period: ${periodLabel}`, pageW - M, 16, { align: "right" })
  doc.text(`Generated: ${fmtDate(new Date().toISOString().slice(0, 10))}`, pageW - M, 21, { align: "right" })

  let y = 33

  // ── Entity name + ID ───────────────────────────────────────────────
  doc.setTextColor(...DARK)
  doc.setFontSize(12)
  doc.setFont("helvetica", "bold")
  doc.text(entityName, M, y)

  doc.setFontSize(8)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...MID)
  doc.text(
    `${entityType === "client" ? "Client" : "Supplier"} ID: ${entityIdLabel ?? "—"}`,
    M, y + 5
  )

  y += 13

  // ── Summary block ──────────────────────────────────────────────────
  const openingLabel =
    openingBalance != null
      ? `${fmt(Math.abs(openingBalance))} BDT${openingBalance > 0 ? " Dr" : openingBalance < 0 ? " Cr" : ""}`
      : "N/A (no start date)"

  const netLabel   = isClient ? "Net Due"      : "Net Payable"
  const netValue   = isClient ? summary.netDue : summary.netPayable
  const paidLabel  = isClient ? "Total Received" : "Total Paid"
  const paidValue  = isClient ? summary.totalReceived : summary.totalPaid

  const summaryData = [
    ["Opening Balance", openingLabel],
    ["Total Invoiced",  `${fmt(summary.totalInvoiced)} BDT`],
    [paidLabel,         `${fmt(paidValue)} BDT`],
    ["Total Refunded",  `${fmt(summary.totalRefunded)} BDT`],
    [netLabel,          `${fmt(netValue)} BDT${netValue > 0 ? " Dr" : netValue < 0 ? " Cr" : ""}`],
    ["Unallocated",     `${fmt(summary.unallocated)} BDT`],
  ]

  // 2-column summary table
  autoTable(doc, {
    startY: y,
    body: summaryData.reduce((rows, _, i, arr) => {
      if (i % 2 === 0) rows.push([arr[i], arr[i + 1] ?? ["", ""]])
      return rows
    }, []).map((pair) => [
      pair[0][0], pair[0][1],
      pair[1][0] ?? "", pair[1][1] ?? "",
    ]),
    margin: { left: M, right: M },
    theme: "plain",
    styles: { fontSize: 8, cellPadding: { top: 1.5, bottom: 1.5, left: 3, right: 3 } },
    columnStyles: {
      0: { fontStyle: "normal", textColor: MID, cellWidth: W / 2 * 0.45 },
      1: { fontStyle: "bold",   textColor: DARK, cellWidth: W / 2 * 0.55 },
      2: { fontStyle: "normal", textColor: MID, cellWidth: W / 2 * 0.45 },
      3: { fontStyle: "bold",   textColor: DARK, cellWidth: W / 2 * 0.55 },
    },
    tableLineColor: [229, 231, 235],
    tableLineWidth: 0.1,
    didDrawCell: (data) => {
      // draw subtle bg
      if (data.row.index % 2 === 0) {
        doc.setFillColor(...LIGHT)
        doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, "F")
        doc.setTextColor(data.column.index % 2 === 0 ? MID[0] : DARK[0],
                         data.column.index % 2 === 0 ? MID[1] : DARK[1],
                         data.column.index % 2 === 0 ? MID[2] : DARK[2])
        doc.setFont("helvetica", data.column.index % 2 === 0 ? "normal" : "bold")
        doc.setFontSize(8)
        doc.text(String(data.cell.raw ?? ""), data.cell.x + 3, data.cell.y + data.cell.height / 2 + 1.5)
      }
    },
  })

  y = doc.lastAutoTable.finalY + 6

  // ── Section label ──────────────────────────────────────────────────
  doc.setFontSize(8)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...MID)
  doc.text("TRANSACTIONS", M, y)
  y += 3

  // ── Transactions table (ascending order + running balance) ───────
  const ascEntries = [...entries].reverse()

  // Compute running balance per row
  let runBal = openingBalance ?? 0
  const rows = ascEntries.map((e) => {
    if (e.debit  != null) runBal += e.debit
    if (e.credit != null) runBal -= e.credit
    const balLabel = runBal === 0 ? "0" : `${fmt(Math.abs(runBal))} ${runBal > 0 ? "Dr" : "Cr"}`
    return [
      fmtDate(e.date),
      e.type === "invoice" ? "Invoice" : e.type === "payment" ? "Payment" : "Refund",
      e.description ?? "—",
      fmtDate(e.refIssueDate),
      e.trxId ?? "—",
      e.debit  != null ? fmt(e.debit)  : "—",
      e.credit != null ? fmt(e.credit) : "—",
      balLabel,
      runBal,   // raw number for coloring — stripped before display
    ]
  })

  autoTable(doc, {
    startY: y,
    head: [["Date", "Type", "Description", "Ref. Issue Date", "Trx ID", "Debit", "Credit", "Balance"]],
    body: rows.map((r) => r.slice(0, 8)),   // drop the raw number
    margin: { left: M, right: M },
    styles: { fontSize: 7.5, cellPadding: 2.2, overflow: "linebreak", textColor: DARK },
    headStyles: {
      fillColor: BLUE,
      textColor: WHITE,
      fontStyle: "bold",
      fontSize: 7.5,
    },
    alternateRowStyles: { fillColor: LIGHT },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 15 },
      2: { cellWidth: 46 },
      3: { cellWidth: 20 },
      4: { cellWidth: 22 },
      5: { cellWidth: 18, halign: "right" },
      6: { cellWidth: 18, halign: "right" },
      7: { cellWidth: 23, halign: "right", fontStyle: "bold" },
    },
    didParseCell: (data) => {
      if (data.section === "body") {
        if (data.column.index === 5 && data.cell.raw !== "—") {
          data.cell.styles.textColor = [220, 38, 38]
        }
        if (data.column.index === 6 && data.cell.raw !== "—") {
          data.cell.styles.textColor = [22, 163, 74]
        }
        if (data.column.index === 7) {
          const rawBal = rows[data.row.index]?.[8] ?? 0
          data.cell.styles.textColor = rawBal > 0 ? [220, 38, 38] : rawBal < 0 ? [22, 163, 74] : DARK
        }
      }
    },
    didDrawPage: (data) => {
      const pg = data.pageNumber
      const total = doc.internal.getNumberOfPages()
      doc.setFontSize(7)
      doc.setFont("helvetica", "normal")
      doc.setTextColor(...MID)
      doc.text(`Page ${pg} of ${total}`, pageW - M, pageH - 8, { align: "right" })
      doc.text("Generated by Ticket Tracker", M, pageH - 8)
    },
  })

  // ── Save ───────────────────────────────────────────────────────────
  const safeName = entityName.replace(/[^a-z0-9]/gi, "_").slice(0, 30)
  const suffix = dateFrom ? `_${dateFrom}` : "_all-time"
  doc.save(`${entityType === "client" ? "Client" : "Supplier"}Ledger_${safeName}${suffix}.pdf`)
}
