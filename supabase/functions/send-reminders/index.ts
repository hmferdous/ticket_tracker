import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const RESEND_ENABLED = Deno.env.get("RESEND_ENABLED") === "true"
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? ""
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Ticket Tracker <reminders@yourdomain.com>"

Deno.serve(async (_req) => {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)

  const addDays = (n: number): string => {
    const d = new Date(today)
    d.setDate(d.getDate() + n)
    return d.toISOString().slice(0, 10)
  }

  // Current hour in Bangladesh time (UTC+6)
  const bdHour = (today.getUTCHours() + 6) % 24

  const { data: agents, error: agentsError } = await admin
    .from("agents")
    .select("id, user_id, full_name, reminder_days_client, reminder_days_supplier, reminder_hour")
    .eq("reminder_enabled", true)
    .eq("reminder_hour", bdHour)

  if (agentsError) {
    return new Response(JSON.stringify({ error: agentsError.message }), { status: 500 })
  }

  const results: { agent: string; ticket_id: string; type: string }[] = []
  const errors: { agent_id: string; error: string }[] = []

  for (const agent of agents ?? []) {
    try {
      const { data: authUser } = await admin.auth.admin.getUserById(agent.user_id)
      const agentEmail = authUser?.user?.email
      if (!agentEmail) continue

      const agentName = agent.full_name || agentEmail

      // ── Client payment reminders ──────────────────────────────────────
      const clientDays = agent.reminder_days_client ?? 0
      if (clientDays > 0) {
        const windowEnd = addDays(clientDays)

        const { data: tickets } = await admin
          .from("tickets")
          .select("id, passenger_name, route, travel_date, sell_price, amount_paid, pnr, ticket_number, clients(name)")
          .eq("agent_id", agent.id)
          .neq("status", "void")
          .neq("payment_status", "paid")
          .gte("travel_date", todayStr)
          .lte("travel_date", windowEnd)

        for (const ticket of tickets ?? []) {
          const { count } = await admin
            .from("reminders")
            .select("*", { count: "exact", head: true })
            .eq("ticket_id", ticket.id)
            .eq("type", "client_payment")

          if ((count ?? 0) >= 3) continue

          const outstanding = (ticket.sell_price ?? 0) - (ticket.amount_paid ?? 0)
          if (outstanding <= 0) continue

          if (!RESEND_ENABLED) continue

          await sendEmail(agentEmail, agentName, ticket, "client_payment", outstanding)

          await admin.from("reminders").insert({
            agent_id: agent.id,
            ticket_id: ticket.id,
            type: "client_payment",
            due_date: ticket.travel_date,
          })

          results.push({ agent: agentEmail, ticket_id: ticket.id, type: "client_payment" })
        }
      }

      // ── Supplier payment reminders ────────────────────────────────────
      const supplierDays = agent.reminder_days_supplier ?? 0
      if (supplierDays > 0) {
        const windowEnd = addDays(supplierDays)

        const { data: tickets } = await admin
          .from("tickets")
          .select("id, passenger_name, route, travel_date, purchase_price, pnr, ticket_number, suppliers(name), ticket_payments(type, allocated_amount)")
          .eq("agent_id", agent.id)
          .neq("status", "void")
          .gte("travel_date", todayStr)
          .lte("travel_date", windowEnd)

        for (const ticket of tickets ?? []) {
          const supplierPaid = (ticket.ticket_payments ?? [])
            .filter((tp: any) => tp.type === "supplier")
            .reduce((sum: number, tp: any) => sum + (tp.allocated_amount ?? 0), 0)

          const supplierOutstanding = (ticket.purchase_price ?? 0) - supplierPaid
          if (supplierOutstanding <= 0) continue

          const { count } = await admin
            .from("reminders")
            .select("*", { count: "exact", head: true })
            .eq("ticket_id", ticket.id)
            .eq("type", "supplier_payment")

          if ((count ?? 0) >= 3) continue

          if (!RESEND_ENABLED) continue

          await sendEmail(agentEmail, agentName, ticket, "supplier_payment", supplierOutstanding)

          await admin.from("reminders").insert({
            agent_id: agent.id,
            ticket_id: ticket.id,
            type: "supplier_payment",
            due_date: ticket.travel_date,
          })

          results.push({ agent: agentEmail, ticket_id: ticket.id, type: "supplier_payment" })
        }
      }
    } catch (err: any) {
      errors.push({ agent_id: agent.id, error: err.message ?? String(err) })
    }
  }

  return new Response(JSON.stringify({ resend_enabled: RESEND_ENABLED, sent: results.length, results, errors }), {
    headers: { "Content-Type": "application/json" },
  })
})

async function sendEmail(
  to: string,
  agentName: string,
  ticket: any,
  type: "client_payment" | "supplier_payment",
  outstanding: number
) {
  const isClient = type === "client_payment"
  const party = isClient ? ticket.clients?.name : ticket.suppliers?.name
  const partyLabel = isClient ? "Client" : "Supplier"

  const subject = `${isClient ? "Client Payment" : "Supplier Payment"} Reminder — ${ticket.passenger_name} (${ticket.route})`

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
  <div style="background:#2563eb;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h1 style="margin:0;font-size:18px;font-weight:700;">Ticket Tracker</h1>
    <p style="margin:4px 0 0;opacity:.85;font-size:13px;">${isClient ? "Client" : "Supplier"} Payment Reminder</p>
  </div>
  <div style="background:white;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
    <p style="color:#374151;margin-top:0;">Hi ${agentName},</p>
    <p style="color:#374151;">
      ${isClient
        ? `The client has an outstanding payment due. The flight is on <strong>${ticket.travel_date}</strong>.`
        : `You have an outstanding payment to the supplier. The flight is on <strong>${ticket.travel_date}</strong>.`}
    </p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <td style="padding:10px 14px;color:#6b7280;width:40%;border-bottom:1px solid #f3f4f6;">Passenger</td>
        <td style="padding:10px 14px;color:#111827;font-weight:600;border-bottom:1px solid #f3f4f6;">${ticket.passenger_name}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Route</td>
        <td style="padding:10px 14px;color:#111827;border-bottom:1px solid #f3f4f6;">${ticket.route}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Travel Date</td>
        <td style="padding:10px 14px;color:#111827;border-bottom:1px solid #f3f4f6;">${ticket.travel_date}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #f3f4f6;">PNR</td>
        <td style="padding:10px 14px;color:#111827;font-family:monospace;border-bottom:1px solid #f3f4f6;">${ticket.pnr || "—"}</td>
      </tr>
      ${ticket.ticket_number ? `
      <tr style="background:#f9fafb;">
        <td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Ticket No.</td>
        <td style="padding:10px 14px;color:#111827;font-family:monospace;border-bottom:1px solid #f3f4f6;">${ticket.ticket_number}</td>
      </tr>` : ""}
      <tr ${ticket.ticket_number ? "" : 'style="background:#f9fafb;"'}>
        <td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #f3f4f6;">${partyLabel}</td>
        <td style="padding:10px 14px;color:#111827;border-bottom:1px solid #f3f4f6;">${party || "—"}</td>
      </tr>
      <tr style="background:#fef2f2;">
        <td style="padding:12px 14px;color:#6b7280;font-weight:600;">Outstanding</td>
        <td style="padding:12px 14px;color:#dc2626;font-weight:700;font-size:16px;">৳ ${outstanding.toLocaleString("en-BD")}</td>
      </tr>
    </table>
    <p style="color:#6b7280;font-size:13px;margin-bottom:0;">
      Log in to <a href="https://ticket-tracker-henna.vercel.app" style="color:#2563eb;">Ticket Tracker</a> to record the payment.
    </p>
  </div>
</div>`

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Resend API error: ${text}`)
  }
}
