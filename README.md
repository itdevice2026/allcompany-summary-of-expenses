# ALLCOMPANY Summary of Expenses

Web app for liquidating reimbursable expenses across the Meatplus group of companies:
Meatplus Trading Corp., Pacific Magalang Agriventures Inc., Pacific Agrisolutions Enterprises Inc.,
FoodSolutions Enterprises Inc., Meatplus Logistics Corporation and North Breeders Corporation.

- **Employees** sign in, encode receipts (invoice date, SI#, supplier, TIN, amount, department, description), submit to Finance, and print the Summary of Expenses form.
- **Finance** reviews every report, adds line remarks, approves or returns with a note, and exports the list to CSV.
- **Admin** edits company names/addresses and assigns roles.

## Stack

- Static site (`index.html`, `app.js`, `style.css`) hosted on GitHub Pages
- Supabase (project `bom-system`) for login and data — tables prefixed `soe_`
- Row Level Security on every table; workflow rules enforced in the `soe_reports_before` trigger

## Database objects

| Object | Purpose |
|---|---|
| `soe_profiles` | One row per user: name, department, role (`employee`, `finance`, `admin`, `disabled`) |
| `soe_companies` | The six group companies and their printed addresses |
| `soe_reports` | Expense reports; line items stored as JSON in `items` |
| `soe_counters` | Reference-number counters (`MTC-2610-0001`), server-only |
| `soe_me()` | Creates the signed-in user's profile on first use |
| `soe_role()` | Returns the signed-in user's role for RLS policies |

Rules enforced on the server:
- Employees see and edit only their own reports, and only while Draft or Returned.
- Only Finance/Admin can approve or return; reviewers can't change the employee's name, department or company.
- Totals and reference numbers are computed by the database.
- Only Admin can change roles or company details.

## Supabase settings to check

In Supabase → Authentication → URL Configuration, add the GitHub Pages URL to **Redirect URLs** so
sign-up confirmation and password-reset emails return to this app.

## Local development

Open `index.html` through any static server, e.g. `npx serve .`
