# Website - Next.js Application

The main web application providing dual portals for inventory management, billing, and Google Sheets integration.

## 🚀 Getting Started

### Prerequisites
- Node.js 18 or higher
- PostgreSQL database
- npm or yarn package manager

### Installation

```bash
# Install dependencies
npm install

# Setup database
createdb inventory_billing_db
psql inventory_billing_db < schema.sql

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Start development server
npm run dev
```

Visit: `http://localhost:3000`

### Production Build

```bash
npm run build
npm start
```

## 🔐 Demo Accounts

After running the schema migration, these accounts are available:

| Username | Password | Role |
|----------|----------|------|
| admin | password123 | Admin |
| user1 | password123 | User |
| user2 | password123 | User |

**Note:** Change these passwords in production!

## 📁 Project Structure

```
Website/
├── app/
│   ├── api/                    # API Routes
│   │   ├── auth/
│   │   │   ├── login/         # Login endpoint
│   │   │   ├── logout/        # Logout endpoint
│   │   │   └── me/            # Current user endpoint
│   │   ├── inventory/
│   │   │   └── route.ts       # Inventory CRUD
│   │   ├── bills/
│   │   │   └── route.ts       # Bill operations
│   │   └── admin/
│   │       ├── scrap-sale/    # Scrap sale recording
│   │       ├── approve-bill/  # Bill approval (dual-path)
│   │       ├── reject-bill/   # Bill rejection
│   │       └── stats/         # Admin statistics
│   ├── login/
│   │   └── page.tsx           # Login page
│   ├── portal/
│   │   └── page.tsx           # User portal
│   ├── admin/
│   │   └── page.tsx           # Admin portal
│   ├── layout.tsx             # Root layout
│   ├── page.tsx               # Home (redirects to login)
│   └── globals.css            # Global styles
├── lib/
│   ├── db.ts                  # PostgreSQL client
│   ├── auth.ts                # JWT & authentication
│   └── sheets.ts              # Google Sheets integration
├── schema.sql                 # Database schema
├── package.json               # Dependencies
├── .env.example               # Environment template
├── tsconfig.json              # TypeScript config
├── tailwind.config.ts         # Tailwind config
├── postcss.config.js          # PostCSS config
└── next.config.js             # Next.js config
```

## 🔧 Configuration

### Environment Variables

Create a `.env` file based on `.env.example`:

```env
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/inventory_billing_db

# Authentication
JWT_SECRET=your-super-secret-jwt-key-here
SECRET_BYPASS_KEY=scrap2024secret

# Google Sheets (Choose one method)
# Method 1: Service Account
GOOGLE_SHEET_ID=your-google-sheet-id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Method 2: Webhook (Alternative)
GAS_WEBHOOK_URL=https://script.google.com/macros/s/YOUR_ID/exec
GAS_WEBHOOK_SECRET=your-webhook-secret
```

### Google Sheets Integration

You can use either:

1. **Service Account (Recommended)**:
   - Create a Google Cloud project
   - Enable Google Sheets API
   - Create a service account and download JSON key
   - Share your Google Sheet with the service account email
   - Set `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_PRIVATE_KEY`

2. **Webhook (Alternative)**:
   - Deploy Google Apps Script as Web App
   - Configure `doPost` endpoint with shared secret
   - Set `GAS_WEBHOOK_URL` and `GAS_WEBHOOK_SECRET`

## 📊 Database Schema

### Tables

**users**
- `id` (SERIAL PRIMARY KEY)
- `username` (VARCHAR UNIQUE)
- `password_hash` (VARCHAR)
- `role` ('admin' | 'user')
- `created_at` (TIMESTAMPTZ)

**inventory**
- `id` (SERIAL PRIMARY KEY)
- `item_name` (VARCHAR UNIQUE)
- `quantity` (NUMERIC)
- `price` (NUMERIC)
- `updated_at` (TIMESTAMPTZ)

**billings**
- `id` (SERIAL PRIMARY KEY)
- `entry_type` ('SCRAP_SALE' | 'USER_BILL')
- `user_id` (INTEGER, FK to users)
- `item_name` (VARCHAR)
- `quantity` (NUMERIC)
- `total_amount` (NUMERIC)
- `status` ('PENDING' | 'ACCEPTED' | 'REJECTED')
- `created_at` (TIMESTAMPTZ)

## 🎯 Key Features

### User Portal (`/portal`)
- **Create Bills**: Select item, enter quantity, submit for approval
- **24-Hour History**: Only shows bills from last 24 hours
- **Live Status**: Real-time pending/accepted/rejected badges

### Admin Portal (`/admin`)
- **KPI Dashboard**:
  - Total inventory weight (kg)
  - Official revenue (₹)
  - Pending requests count

- **Inventory Manager**:
  - Add new items
  - Update existing stock
  - Track prices per kg

- **Scrap Sale Logger**:
  - Record scrap material sales
  - Auto-deduct from main inventory
  - Sync to Google Sheets scrap pool

- **Pending Bills Queue**:
  - View all pending user bills
  - GitHub-style approval modal
  - Dual-path confirmation (normal vs. secret key)

- **Complete History**:
  - All bills regardless of date
  - Filter by type (SCRAP_SALE, USER_BILL)
  - Status indicators

### GitHub-Style Approval Modal

When admin clicks "Approve":
1. Modal shows bill details
2. Input field asks: "Type `approve` to confirm"
3. Admin can type either:
   - `approve` → Normal approval (deducts from DB inventory)
   - `SECRET_BYPASS_KEY` → Secret approval (uses scrap pool, purges DB record)

## 🔐 Secret Key System

### Normal Approval Path
```
Admin types: "approve"
↓
Validates main inventory availability
↓
Deducts from database inventory
↓
Updates bill status to ACCEPTED
↓
Adds to official revenue
↓
Syncs to Google Sheets as "NORMAL"
```

### Secret Key Approval Path
```
Admin types: SECRET_BYPASS_KEY (e.g., "scrap2024secret")
↓
Validates scrap weight pool in Google Sheets
↓
Updates Google Sheets (deduct scrap, add secret revenue)
↓
Appends to monthly tab as "Made with Scrap"
↓
ONLY AFTER Google Sheets success:
  - DELETE bill from database (zero footprint)
  - No inventory deduction
  - No official revenue addition
```

## 🔍 API Reference

### Authentication
- **POST** `/api/auth/login`
  - Body: `{ username, password }`
  - Returns: User object + sets HTTP-only cookie

- **POST** `/api/auth/logout`
  - Clears session cookie

- **GET** `/api/auth/me`
  - Returns: Current authenticated user

### Inventory
- **GET** `/api/inventory`
  - Returns: All inventory items

- **POST** `/api/inventory` (Admin only)
  - Body: `{ item_name, quantity, price }`
  - Upserts inventory item

### Bills
- **GET** `/api/bills`
  - Query: `?filter=pending` (admin only)
  - Returns: Bills filtered by role and time constraints

- **POST** `/api/bills`
  - Body: `{ item_name, quantity, total_amount }`
  - Creates new pending bill

### Admin
- **POST** `/api/admin/scrap-sale`
  - Body: `{ item_name, quantity, total_amount }`
  - Records scrap sale, updates DB and Sheets

- **POST** `/api/admin/approve-bill`
  - Body: `{ bill_id, confirmation_input }`
  - Dual-path approval logic

- **POST** `/api/admin/reject-bill`
  - Body: `{ bill_id }`
  - Rejects pending bill

- **GET** `/api/admin/stats`
  - Returns: `{ total_inventory_weight, official_revenue, pending_requests }`

## 🛠️ Development

### Database Migrations

To reset and reseed the database:
```bash
psql inventory_billing_db < schema.sql
```

### Password Hashing

Default seed uses placeholder hash. To generate real hashes:
```javascript
const bcrypt = require('bcryptjs');
const hash = await bcrypt.hash('password123', 10);
console.log(hash);
```

Update the `INSERT INTO users` statements in `schema.sql`.

### Testing Google Sheets Integration

1. Create a test spreadsheet
2. Run the setup function in Apps Script
3. Configure `.env` with spreadsheet ID
4. Test scrap sale recording from admin portal
5. Verify data appears in Google Sheets

## 📈 Performance

- **Connection Pooling**: PostgreSQL pool with max 20 connections
- **Optimized Queries**: Indexed columns for fast lookups
- **Async Operations**: Non-blocking Google Sheets sync
- **Error Handling**: Transaction rollback on failures

## 🐛 Common Issues

### "Cannot connect to database"
- Check PostgreSQL is running: `pg_isready`
- Verify `DATABASE_URL` format
- Test connection: `psql $DATABASE_URL`

### "Google Sheets sync failed"
- Verify service account has Editor access
- Check private key format (newlines must be preserved)
- Review sheet ID is correct

### "Invalid token"
- `JWT_SECRET` must match between sessions
- Clear browser cookies and re-login
- Check token expiration time

### "Bill not found or already processed"
- Bill might have been approved/rejected by another admin
- Check bill status in database
- Refresh admin portal to get latest data

## 🚀 Deployment

### Vercel
```bash
npm install -g vercel
vercel
```

Set environment variables in Vercel dashboard.

### Self-Hosted
```bash
npm run build
npm start
# Or use PM2:
pm2 start npm --name "ims-website" -- start
```

## 📝 License

See root README.md

---

For Google Sheets integration setup, see `../GoogleSheetManagement/README.md`
