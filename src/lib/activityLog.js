import { supabase } from "./supabase"

// One shared insert path for ticket_activity_log so every call site writes
// the same shape. event_type is plain text (not a DB-level enum/check
// constraint) so a new event type never needs a migration to add. One of
// ticketId/paymentId is expected to be set (a payment event can touch zero,
// one, or many tickets over its life, so it's logged once per payment
// rather than once per ticket it happens to reach); both can be set
// together, e.g. "payment allocated to ticket X". Errors are swallowed —
// logging is a best-effort audit trail, never something that should block
// the actual mutation it's describing.
export async function logActivity({ agentId, ticketId = null, paymentId = null, eventType, description, metadata = null }) {
  const { error } = await supabase.from("ticket_activity_log").insert({
    agent_id: agentId,
    ticket_id: ticketId,
    payment_id: paymentId,
    event_type: eventType,
    description,
    metadata,
  })
  if (error) console.error("activity log write failed:", error.message)
}
