# 📊 Daily Poll Manager (100% Free WhatsApp Group Integration)

A web application built with **HTML, CSS, JavaScript, and Node.js** to manage daily polls and broadcast them directly into your WhatsApp group as native, interactive WhatsApp polls.

---

## ⚙️ What Is in `.env`?

The `.env` file holds the configuration for your WhatsApp target group and server:

```env
# Server Port
PORT=3000

# WhatsApp Target Group Name
# Set this to the exact name of your WhatsApp group (e.g. "Yuva Varg")
WHATSAPP_GROUP_NAME=Yuva Varg

# Optional: Direct Group ID if known (e.g. 1203630248849xxxxx@g.us)
WHATSAPP_GROUP_ID=
```

- **`WHATSAPP_GROUP_NAME`**: The name of your WhatsApp group exactly as written on your phone.
- **`WHATSAPP_GROUP_ID`**: Optional. If provided, messages are sent directly using this ID. If omitted, the server automatically finds the group matching `WHATSAPP_GROUP_NAME`.
- **`PORT`**: The local server port (default `3000`).

---

## 🚀 How to Run the Project

### Step 1: Install Dependencies
Open your terminal inside this project folder (`daily-poll`) and run:
```bash
npm install
```

### Step 2: Configure Your Group Name
Open `.env` and verify `WHATSAPP_GROUP_NAME` matches your WhatsApp group:
```env
WHATSAPP_GROUP_NAME=Yuva Varg
```

### Step 3: Start the Server
```bash
npm start
```

### Step 4: Link Your WhatsApp (One-Time Setup)
1. Open your browser at: **`http://localhost:3000`**
2. Click on the yellow **"Scan WhatsApp QR"** badge (or view the QR code in your terminal).
3. On your phone, open **WhatsApp** > **Settings** (or 3 dots on Android) > **Linked Devices** > **Link a Device**.
4. Scan the QR code displayed on screen or in your terminal.
5. Once connected, the badge turns **Green: "WhatsApp Connected"**.

*Your session is saved locally in `.wwebjs_auth`, so you won't need to scan again when restarting!*

---

## 📱 Features

1. **Available Polls Tab**: Lists all available daily polls loaded from `data/polls.json`.
2. **Send Poll Button**:
   - Sends a **real interactive WhatsApp Poll** (with clickable checkboxes) straight into your configured group.
   - Updates the poll status to "Sent" and timestamps it.
3. **Sent Polls Tab**: Archive of past polls with the ability to re-send.
4. **Create Poll Tab**: Easily add new poll questions and custom options to the collection.
5. **Zero-Setup Fallback**: If you ever run the HTML file directly without starting Node.js, clicking "Send Poll" automatically opens WhatsApp Web with the pre-formatted poll text ready to send.

---

## 📁 Project Structure

```text
daily-poll/
├── .env                # Environment configuration (Group name & port)
├── .env.example        # Environment template
├── package.json        # Dependencies (Express, whatsapp-web.js, qrcode)
├── server.js           # Backend server & WhatsApp Web client
├── data/
│   └── polls.json      # JSON file storing all poll questions and options
├── public/
│   ├── index.html      # Main Web Dashboard UI
│   ├── style.css       # Clean, modern responsive stylesheet
│   └── app.js          # Client-side dynamic rendering & API calls
└── README.md           # Documentation & instructions
```
