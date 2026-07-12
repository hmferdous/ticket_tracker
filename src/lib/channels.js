import { supabase } from "./supabase"

export function fetchChannels(agentId, { includeArchived = false } = {}) {
  let query = supabase
    .from("payment_channels")
    .select("id, name, starting_balance, is_active, created_at")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: true })
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
