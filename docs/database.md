# Database Rules

## Stack
Supabase (Postgres) hosted at ap-south-1 Mumbai
All tables have Row Level Security (RLS) enabled
Never disable RLS on any table

## Tables
- agents — one row per user. Links to auth.users via user_id. Contains plan, trial_ends_at, is_admin
- clients — belongs to agent via agent_id
- suppliers — belongs to agent via agent_id
- tickets — core table. belongs to agent. links to client and supplier
- payments — every money movement. type can be: client_payment, supplier_payment, client_refund, supplier_refund
- reminders — email reminder rules per ticket

## Key Fields on Tickets
- purchase_price — what agent paid supplier
- sell_price — actual price charged to client (real number, private)
- reported_price — what agent reports to their company (can differ from sell_price)
- status — booked, collected, supplier_paid, flown, closed
- refund_status — null, initiated, received, paid

## Rules
- Always filter by agent_id when querying any table
- Get agent_id from the agents table using auth.uid() = user_id
- Never hardcode agent_id
- Always use the useAuth hook to get the current agent object
- agent.id is the agent_id to use in all queries
