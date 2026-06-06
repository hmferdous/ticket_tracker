# Operations Rules

## Environment
- Local dev: http://localhost:5173
- Production: https://ticket-tracker-henna.vercel.app
- Supabase project: vdpjgshdnaqczgjmardt (Mumbai ap-south-1)

## Environment Variables
- VITE_SUPABASE_URL — in .env.local only, never commit
- VITE_SUPABASE_ANON_KEY — in .env.local only, never commit
- .env.local is in .gitignore

## Git Rules
- Always commit before starting a new phase
- Commit message format: phase X: description
- Push to main triggers auto deploy on Vercel

## Folder Structure
- src/pages/agent/ — agent facing pages
- src/pages/admin/ — admin facing pages
- src/components/ui/ — reusable components
- src/components/tickets/ — ticket components
- src/components/clients/ — client components
- src/components/suppliers/ — supplier components
- src/components/payments/ — payment components
- src/lib/ — supabase client and utilities
- src/context/ — auth context
- src/hooks/ — custom hooks
- src/utils/ — helper functions
