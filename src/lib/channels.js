import { supabase } from "./supabase"

export function fetchChannels(agentId, { includeArchived = false } = {}) {
  let query = supabase
    .from("payment_channels")
    .select("id, name, starting_balance, is_active, created_at")
    .eq("agent_id", agentId)
    // Secondary sort on id: rows seeded together in one INSERT (e.g. the
    // default-channel migration) can share an identical created_at, which
    // Postgres doesn't break ties on deterministically without one.
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
  if (!includeArchived) query = query.eq("is_active", true)
  return query
}

// Given the names already in use, returns `desiredName` unchanged if it's free,
// or the next available "Name 2", "Name 3", ... suffix if it collides (case-insensitive).
export function suggestUniqueName(existingNames, desiredName) {
  const trimmed = desiredName.trim()
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()))
  if (!taken.has(trimmed.toLowerCase())) return trimmed
  let n = 2
  while (taken.has(`${trimmed} ${n}`.toLowerCase())) n++
  return `${trimmed} ${n}`
}
