# Google Sheets Management - Apps Script Dashboard

Standalone Google Apps Script application that manages the scrap inventory ledger and provides a real-time analytics dashboard.

## 🎯 Overview

This Google Apps Script application:
- Maintains a secret-key scrap inventory ledger
- Provides a web-based analytics dashboard
- Auto-creates monthly bill tracking tabs
- Handles webhook requests from the Next.js backend
- Tracks normal revenue vs. scrap revenue separately

## 📁 Files

- **Code.gs**: Backend logic (Google Apps Script)
- **Index.html**: Dashboard UI (HTML/CSS/JavaScript)
- **appsscript.json**: Apps Script configuration

## 🚀 Deployment

### Method 1: Manual Copy-Paste (Easiest)

1. **Create a new Google Spreadsheet**
   - Go to https://sheets.google.com
   - Create a new blank spreadsheet
   - Name it "IMS Ledger" or similar

2. **Open Apps Script Editor**
   - Click `Extensions > Apps Script`
   - Delete any default code

3. **Add Code Files**
   - Rename `Code.gs` if needed
   - Copy entire contents of `Code.gs` and paste
   - Click `+` next to Files → `HTML`
   - Name it `Index`
   - Copy entire contents of `Index.html` and paste
   - Click on `appsscript.json` (gear icon)
   - Copy entire contents of `appsscript.json` and paste

4. **Run Setup Function**
   - Select `setupSheets` function from dropdown
   - Click Run (▶️)
   - Authorize the script when prompted
   - Wait for "Execution completed" message

5. **Deploy as Web App**
   - Click `Deploy > New deployment`
   - Click gear icon → Select `Web app`
   - Description: "IMS Dashboard v1"
   - Execute as: `Me`
   - Who has access: `Anyone` (or `Anyone with Google account` for security)
   - Click `Deploy`
   - Copy the Web App URL (save this!)

6. **Test Dashboard**
   - Click the Web App URL
   - You should see the IMS Dashboard
   - Verify KPI cards and empty bills table

### Method 2: clasp (Command Line)

```bash
# Install clasp globally
npm install -g @google/clasp

# Login to Google
clasp login

# Create new project
clasp create --type sheets --title "IMS Ledger"

# Push code
clasp push

# Deploy
clasp deploy
```

## 🔧 Configuration

### Webhook Secret

Edit `Code.gs` line 6:
```javascript
const WEBHOOK_SECRET = 'your-shared-webhook-secret-key';
```

This secret must match the `GAS_WEBHOOK_SECRET` in the Next.js `.env` file.

### Timezone

Edit `appsscript.json`:
```json
{
  "timeZone": "Asia/Kolkata"
}
```

Change to your timezone.

## 📊 Google Sheets Structure

After running `setupSheets()`, your spreadsheet will have:

### Tab 1: `Scrap_Inventory_Master`

**Purpose**: Track monthly scrap inventory and revenue

**Columns**:
1. `Month_Year` - e.g., "November 2026"
2. `Carryover_Weight_KG` - Leftover scrap from previous month
3. `New_Scrap_Added_KG` - Scrap added this month via scrap sales
4. `Total_Weight_KG` - Carryover + New Scrap
5. `Used_Weight_KG` - Scrap used by secret key bills
6. `Available_Weight_KG` - Total - Used
7. `Scrap_Sale_Offset_INR` - Negative offset (e.g., -2000 when 50kg sold for ₹2000)
8. `Secret_Bills_Revenue_INR` - Sum of secret key bills this month
9. `Net_Scrap_Revenue_INR` - Scrap Offset + Secret Revenue
10. `Normal_Bills_Revenue_INR` - Official revenue this month
11. `Updated_At` - Last update timestamp

**Auto-Rollover**: When a new month starts, the previous month's `Available_Weight_KG` becomes the new month's `Carryover_Weight_KG`.

### Tab 2+: Monthly Bill Tabs

**Naming**: `Month Year` format (e.g., "November 2026", "December 2026")

**Columns**:
1. `Date_Time` - Bill timestamp
2. `Bill_ID` - Reference to database bill ID
3. `Customer_Username` - Who created the bill
4. `Item_Name` - Product name
5. `Quantity_KG` - Quantity in kg
6. `Total_Amount_INR` - Bill amount
7. `Approval_Type` - "NORMAL" or "Made with Scrap"

## 🔌 Webhook Integration

The Next.js backend can call the `doPost` endpoint with these actions:

### Record Scrap Sale
```javascript
POST https://script.google.com/.../exec
{
  "secret": "your-webhook-secret",
  "action": "RECORD_SCRAP_SALE",
  "data": {
    "itemName": "Iron Scrap",
    "quantity": 50,
    "amount": 2000
  }
}
```

### Approve Normal Bill
```javascript
POST https://script.google.com/.../exec
{
  "secret": "your-webhook-secret",
  "action": "APPROVE_NORMAL_BILL",
  "data": {
    "billId": 123,
    "username": "user1",
    "itemName": "Copper Wire",
    "quantity": 5,
    "amount": 1250
  }
}
```

### Approve Secret Bill
```javascript
POST https://script.google.com/.../exec
{
  "secret": "your-webhook-secret",
  "action": "APPROVE_SECRET_BILL",
  "data": {
    "billId": 124,
    "username": "user2",
    "itemName": "Steel Rods",
    "quantity": 2,
    "amount": 120
  }
}
```

## 🖥️ Dashboard Features

### KPI Cards
- **Normal Revenue**: Official cashflow (scrap sales + normal bills)
- **Scrap Revenue**: Net scrap balance (offset + secret bills)
- **Total Revenue**: Combined cashflow
- **Scrap Weight Pool**: Live weight availability with progress bar

### Month Selector
- Dropdown showing all available months
- Defaults to current month
- Updates KPIs and bills table on change

### Bills Table
- **Search**: Filter by Bill ID, Customer, or Item Name
- **Filter Pills**:
  - All Bills
  - Normal Approved (emerald badge)
  - Made with Scrap (amber badge)
- **Color Coding**:
  - Green badges for normal bills
  - Amber badges for secret key bills

### Manual Scrap Entry
- Add scrap directly from dashboard
- Updates `Scrap_Inventory_Master` immediately
- Useful for one-off scrap additions

## 🔐 Security

### Script Lock
All webhook handlers use `LockService.getScriptLock()` to prevent race conditions when multiple requests arrive simultaneously.

### Secret Validation
Every `doPost` request validates the webhook secret before processing.

### Access Control
Web app can be configured to:
- `Anyone` - Public access (use webhook secret for security)
- `Anyone with Google account` - Requires Google login
- `Anyone within [domain]` - Organization-only

## 📈 Data Flow Examples

### Example 1: Scrap Sale

**Initial State:**
- Main Inventory: 100 kg Iron Scrap
- Scrap Pool: 0 kg
- Normal Revenue: ₹0
- Scrap Revenue: ₹0

**Admin Action:** Record scrap sale (50 kg for ₹2,000)

**Next.js Backend:**
1. Deduct 50 kg from database inventory (100 → 50 kg)
2. Add ₹2,000 to database revenue
3. Insert `SCRAP_SALE` bill record

**Google Sheets:**
1. Add 50 kg to scrap pool (0 → 50 kg available)
2. Set scrap offset to -₹2,000
3. Add ₹2,000 to normal revenue

**Final State:**
- Main Inventory: 50 kg
- Scrap Pool: 50 kg available
- Normal Revenue: ₹2,000
- Scrap Revenue: -₹2,000
- Net Total: ₹0 (balanced)

### Example 2: Secret Key Approval

**Initial State** (after Example 1):
- Main Inventory: 50 kg
- Scrap Pool: 50 kg available
- Normal Revenue: ₹2,000
- Scrap Revenue: -₹2,000

**Admin Action:** Approve user bill via secret key (2 kg for ₹1,000)

**Next.js Backend:**
1. Validate scrap pool has ≥2 kg ✓
2. Call Google Sheets webhook
3. Wait for success response
4. DELETE bill from database

**Google Sheets:**
1. Deduct 2 kg from scrap pool (50 → 48 kg)
2. Add ₹1,000 to secret revenue (-₹2,000 → -₹1,000)
3. Append to monthly tab as "Made with Scrap"

**Final State:**
- Main Inventory: 50 kg (unchanged)
- Scrap Pool: 48 kg available
- Normal Revenue: ₹2,000 (unchanged)
- Scrap Revenue: -₹1,000
- Net Total: ₹1,000

## 🐛 Troubleshooting

### "Execution failed" when running setupSheets
- Grant all requested permissions
- Check if sheets already exist (function is idempotent)

### Dashboard shows "Loading..." forever
- Check Apps Script execution logs: `View > Logs`
- Verify `getDashboardData` function works
- Test in Apps Script editor first

### Webhook returns "Unauthorized"
- Verify webhook secret matches between Apps Script and Next.js
- Check `doPost` is receiving the request (view logs)

### Bills not appearing in dashboard
- Verify correct month is selected
- Check monthly tab was created
- Review `Scrap_Inventory_Master` for current month row

### "Insufficient scrap weight" error
- Check `Available_Weight_KG` in current month row
- Verify scrap sale was recorded correctly
- Run manual scrap entry to add more

## 🔄 Maintenance

### Monthly Rollover
Automatic! When the first transaction of a new month occurs, the script:
1. Reads previous month's `Available_Weight_KG`
2. Creates new row with that value as `Carryover_Weight_KG`
3. Auto-creates new monthly bill tab

### Backup
Regularly backup your Google Spreadsheet:
- `File > Make a copy`
- Or use Google Takeout

### Logs
View execution logs:
- Apps Script Editor → `View > Logs`
- Or `View > Executions` for detailed history

## 📝 Customization

### Change Dashboard Theme
Edit `Index.html` Tailwind classes:
- Replace `purple-600` with your brand color
- Modify gradient backgrounds
- Adjust card layouts

### Add New Columns
1. Update `Scrap_Inventory_Master` header in `setupSheets()`
2. Modify webhook handlers to write new data
3. Update `getDashboardData()` to return new fields
4. Modify dashboard UI to display new data

### Add Authentication
Wrap dashboard in login check:
```javascript
function doGet(e) {
  const user = Session.getActiveUser().getEmail();
  if (!isAuthorized(user)) {
    return HtmlService.createHtmlOutput('Unauthorized');
  }
  return HtmlService.createHtmlOutputFromFile('Index');
}
```

## 🚀 Advanced Features

### Email Notifications
Add to approval handlers:
```javascript
function sendApprovalEmail(billData) {
  MailApp.sendEmail({
    to: 'admin@example.com',
    subject: 'Bill Approved',
    body: `Bill #${billData.billId} approved`
  });
}
```

### Slack Integration
Post to Slack when secret key is used:
```javascript
function notifySlack(message) {
  UrlFetchApp.fetch(SLACK_WEBHOOK_URL, {
    method: 'post',
    payload: JSON.stringify({ text: message })
  });
}
```

### Data Export
Add export to CSV function:
```javascript
function exportToCSV() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('November 2026');
  const data = sheet.getDataRange().getValues();
  // Process and return CSV
}
```

## 📄 License

See root README.md

---

For Next.js backend integration, see `../Website/README.md`
