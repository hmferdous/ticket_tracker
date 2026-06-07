# Admin Panel Rules

## Access
- Admin users have is_admin = true in the agents table
- Admin routes are under /admin/*
- Non-admin users trying to access /admin routes get redirected to /dashboard

## Admin Features v1
- List all agents
- View each agent's plan, trial expiry, plan expiry, last active
- Manually change an agent's plan (trial, monthly, semi_annual, annual)
- Manually set plan_ends_at date
- Deactivate an agent account
- View basic usage stats per agent (ticket count, last ticket date)

## Pricing Plans
- trial: 30 days free, set at signup
- monthly: 1500 BDT per month
- semi_annual: 8500 BDT per 6 months
- annual: 15000 BDT per year
- Plan changes are manual — admin updates via admin panel after receiving payment

## Feature Gating by Plan
- trial: all core features available, Supplier Purchase Price field hidden
- monthly: all core features available, Supplier Purchase Price field hidden
- semi_annual: all core features available, Supplier Purchase Price field hidden
- annual: all features including Supplier Purchase Price and office markup dashboard
- Pro feature flag: check agent.plan === 'annual' before showing gated fields
