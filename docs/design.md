# Design Rules

## Stack
React + Vite
Tailwind CSS via @tailwindcss/vite plugin
No component library — build clean custom components

## Style Guidelines
- Clean, professional, minimal
- Primary color: blue (blue-600 for buttons, blue-50 for highlights)
- Use white cards with subtle shadows for content areas
- Mobile friendly but desktop first
- Sidebar navigation for main app
- Modals for add/edit forms

## Layout
- Authenticated pages: sidebar on left, content on right
- Sidebar links: Dashboard, Tickets, Clients, Suppliers, Payments, Settings
- Admin pages: separate layout with admin sidebar

## Components
- Reusable UI components go in src/components/ui/
- Feature components go in their respective folder (tickets, clients, suppliers, payments)
- Pages go in src/pages/agent/ for agent facing
- Pages go in src/pages/admin/ for admin facing

## Forms
- Always show validation errors inline
- Show loading state on submit buttons
- Show success/error toast or message after save
