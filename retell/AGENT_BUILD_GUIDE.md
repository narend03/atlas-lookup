# Retell AI – Atlas Recovery Agent (Conversation Flow)

This guide reproduces the call script exactly in Retell's **Conversation Flow Agent** builder. Build it in the dashboard, test it with the web call button, then **Export** the agent and save the JSON as `retell/atlas_recovery_agent.json` in this repo.

## 1. Create the agent

Agents → Create Agent → **Conversation Flow Agent**
- Name: `Atlas Recovery Agent`
- Voice: any English voice (e.g. Cimo or Nancy-style female voice to match the script)
- Language: English (US)

## 2. Global prompt (Agent settings → Global Prompt)

```
You are Nancy, a polite and professional collections representative calling on behalf of Alpha Bank.
Stay calm and courteous at all times. Never disclose account details until identity is verified.
Speak in short sentences. Do not invent balances or terms; use only the information in this flow.
Negotiation limits: never offer a payment plan longer than 24 months and never accept a settlement
below 80% of the balance owed.
```

## 3. Custom function (optional but recommended)

Tools → Add Custom Function
- Name: `lookup_account`
- Description: `Look up an Atlas Recovery account by account number and return balance, status and debtor name.`
- Method: `POST`
- URL: `https://atlas-lookup.onrender.com/retell/lookup`
- Parameters (JSON schema):
  ```json
  {
    "type": "object",
    "properties": {
      "account_number": { "type": "string", "description": "The debtor's account number as spoken by the caller" }
    },
    "required": ["account_number"]
  }
  ```
- Speak during execution: on, "One moment while I pull up your account."

The endpoint returns `{ account_number, debtor_name, phone_number, balance, status, client_name }` on success and `{ "error": "account_not_found" }` with HTTP 404 otherwise.

## 4. Nodes

Draw these nodes and edges. Text in quotes is the node's instruction/prompt.

### Node 1 – Greeting (Conversation node, start)
> Say exactly: "Hello, this is Nancy from Alpha Bank. Is this John Doe?"

Edges:
- **Confirms yes** → Node 2 (Identity Verification)
- **Says no / someone else** → Node 1b

### Node 1b – Reach John (Conversation node)
> Say: "I'm trying to reach John Doe. May I speak with them?"

Edges:
- **John becomes available** → Node 2
- **Not available** → Node 1c
- **Wrong number / person** → Node 1d

### Node 1c – Leave message (Conversation node)
> Ask: "Can you take a message? Please ask John Doe to call Alpha Bank back at their earliest convenience regarding an important account matter." Then thank them.

Edge: → **End Call** node

### Node 1d – Wrong person (Conversation node)
> Apologise for the inconvenience and end the call politely.

Edge: → **End Call** node

### Node 2 – Identity Verification (Conversation node)
> Say: "Thanks John Doe. Can you please confirm the last 4 digits of your social security number?"
> Verified only if the caller says 1234. If they give any other digits, do not reveal any account details.

Edges:
- **Caller says 1234** → Node 3 (optionally via Node 2b if using the function)
- **Any other answer or refuses** → Node 2c

### Node 2b – Look up account (Function node, `lookup_account`) *(optional)*
Ask the caller for their account number, call `lookup_account`, and store the result. On success → Node 3. On 404 → Node 2c with the line "I wasn't able to locate that account."

If you skip the function, hard-code the balance in Node 3 (e.g. $2,450.00) for testing.

### Node 2c – Transfer (Conversation node → Transfer Call node)
> Say: "I'm not able to verify your identity over this call. Let me transfer you to a live agent who can help."

Edge: → **Transfer Call** node (any test number, e.g. +1 415 555 0134)

### Node 3 – Payment Negotiation (Conversation node)
> The caller is verified. Tell them: "Our records show a balance of {{balance}} on your Alpha Bank account. Are you able to take care of the full amount today?"
>
> Negotiation ladder (do not skip steps):
> 1. Ask for payment in full.
> 2. If they cannot, offer a 3-month payment plan (balance ÷ 3 per month).
> 3. If declined, offer a 6-month plan, then 12-month plan.
> 4. If still declined, offer a one-time settlement of 90% of the balance, then as low as 80%.
> 5. If none accepted, offer up to a 24-month plan as the final option.
> Never exceed 24 months. Never go below 80% of the balance. Be empathetic; ask what monthly amount would be manageable and pick the closest option within limits.

Edges:
- **Agrees to any option** → Node 4
- **Refuses everything** → Node 5

### Node 4 – Confirm arrangement (Conversation node)
> Repeat the agreed terms (amount, number of payments, first payment date). Say a confirmation will be sent. Thank them and end the call.

Edge: → End Call

### Node 5 – No agreement (Conversation node)
> Say you understand, note that the balance remains due, and invite them to call back when they are ready. End politely.

Edge: → End Call

## 5. Test then export

1. Click **Test** (web call). Walk through: yes → 1234 → decline full → accept 3-month plan.
2. Repeat with a wrong SSN to confirm the transfer path.
3. Agent page → **⋯** → **Export** → save as `retell/atlas_recovery_agent.json`.
