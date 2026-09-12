**Subject:** Your AI agent can now find accounts by account number

Hi [Name],

Quick update on the change your team asked for: the CollectWise AI agent can now look up an Atlas Recovery account by **account number**, not just by phone number. This is live in a test environment today and ready for your team to try.

**How it works, in plain terms**

1. Your team uploads the `atlas_inventory.csv` file to us whenever your data changes, just as you do today.
2. We load that file into a secure database on our side. Each account number becomes a record we can find in milliseconds.
3. When a debtor gives the agent their account number on a call, the agent checks that database, confirms it found the right person, and continues the conversation with the correct balance and status.

If the account number is not in the latest file, the agent will say it could not find the account and can offer to transfer to a live agent rather than guessing.

**What the file needs to contain**

Each row should have these six columns: `account_number`, `debtor_name`, `phone_number`, `balance`, `status`, and `client_name`. Column order does not matter, and spelling variations like "Account Number" are fine. If a required column is missing entirely, the upload is rejected and nothing changes, so you never end up with a half-loaded file.

**What happens with imperfect rows**

- **Missing account number:** that row is skipped. Everything else in the file still loads. You get a short report listing which lines were skipped and why.
- **Balance that isn't a number** (for example "TBD" or a blank cell): that row is skipped, same as above. Dollar signs and thousands commas such as `$1,250.00` are fine. European-style `1.250,00` is treated as invalid rather than guessed at, since misreading it would change the amount we quote to a debtor.
- **Missing debtor name or status:** skipped, reported.
- **The same account number listed twice:** the last one in the file wins. If an account number is already in our system from a previous upload, the new file's version replaces it. In practice this means re-uploading is always safe and always brings us up to date.
- **Accounts left out of a new file** are kept as they were. Uploads add and update; they do not delete.

**What we need from your side**

- Keep `account_number` unique and present on every row. It is the key the agent relies on.
- Export as plain CSV (Excel's "CSV UTF-8" option works well). Names with a comma, like "Doe, John", need to be in quotes. Excel and Google Sheets do this automatically; a row where they are missing is skipped rather than loaded with the wrong values.
- Send the full current inventory rather than only changed rows if you want to be sure everything is fresh, since we never delete on upload.
- After each upload, glance at the skipped-row report. A handful of skipped rows usually means a formula or blank cell in the source spreadsheet.

Happy to walk your ops team through this on a short call. Once you are comfortable with the test results we can turn it on for live calls.

Best,
[Your name]
Forward Deployed Engineer, CollectWise
