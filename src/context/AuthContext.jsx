import { createContext, useContext, useEffect, useState } from "react"
import { supabase } from "../lib/supabase"

const AuthContext = createContext({})

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [agent, setAgent] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchAgent(session.user)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchAgent(session.user)
      else {
        setAgent(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchAgent = async (user) => {
    const { data } = await supabase
      .from("agents")
      .select("*")
      .eq("user_id", user.id)
      .single()

    if (data) {
      setAgent(data)
      setLoading(false)
      return
    }

    // Agent row missing — create it now that the user has an active session.
    // This handles the case where the signup-time insert was blocked by RLS
    // because email confirmation was required and there was no session yet.
    const trialEndsAt = new Date()
    trialEndsAt.setDate(trialEndsAt.getDate() + 30)

    // ignoreDuplicates: true maps to ON CONFLICT DO NOTHING, so an existing
    // row is never overwritten. The unique constraint on user_id is the
    // database-level guard against races; this is the API-level complement.
    await supabase
      .from("agents")
      .upsert(
        {
          user_id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name ?? null,
          plan: "trial",
          trial_ends_at: trialEndsAt.toISOString(),
        },
        { onConflict: "user_id", ignoreDuplicates: true }
      )

    // Fetch the row unconditionally — ON CONFLICT DO NOTHING returns nothing,
    // so a chained .select() would be null on a race. A separate select is
    // always correct regardless of whether the upsert inserted or skipped.
    const { data: agentRow } = await supabase
      .from("agents")
      .select("*")
      .eq("user_id", user.id)
      .single()

    if (agentRow) await seedDefaultChannels(agentRow.id)

    setAgent(agentRow)
    setLoading(false)
  }

  // Idempotent — skips if the agent already has any channels, so a race
  // between tabs at most double-inserts (harmless, agent can archive dupes)
  // rather than failing the whole login. Errors here are non-fatal; the
  // agent can always add channels manually from Channel Ledger.
  const seedDefaultChannels = async (agentId) => {
    const { count } = await supabase
      .from("payment_channels")
      .select("id", { count: "exact", head: true })
      .eq("agent_id", agentId)

    if (count) return

    const DEFAULT_CHANNELS = ["Cash", "bKash", "Bank", "Office", "EBL", "DBBL", "IBBL", "City", "BRAC", "UCB"]
    await supabase.from("payment_channels").insert(DEFAULT_CHANNELS.map((name) => ({ agent_id: agentId, name })))
  }

  const signUp = async (email, password, fullName) => {
    // Store full_name in auth metadata so fetchAgent can use it when it
    // auto-creates the agent row on first login (after email confirmation).
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    if (error) return { error }
    return { data }
  }

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, agent, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)