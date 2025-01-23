require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
const PORT = 3000;

// Load environment variables
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// WhatsApp Webhook Verification
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("Webhook verified!");
        res.status(200).send(challenge);
    } else {
        res.status(403).send("Verification failed.");
    }
});

// WhatsApp Webhook Endpoint
app.post("/webhook", async (req, res) => {
    try {
        const message = req.body.entry[0]?.changes[0]?.value?.messages[0];
        if (!message) {
            return res.status(400).send("No message received.");
        }

        const from = message.from; // Sender's phone number
        const text = message.text?.body || ""; // Message content
        console.log(`Received message: "${text}" from ${from}`);

        // Process message and get response from Gemini API
        const geminiResponse = await axios.post("https://gemini-api.example.com/chat", {
            message: text,
        });

        const botReply = geminiResponse.data.reply || "I'm not sure how to respond to that.";

        // Send a response to the user
        await axios.post(
            `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: from,
                text: { body: botReply },
            },
            {
                headers: {
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                    "Content-Type": "application/json",
                },
            }
        );

        res.status(200).send("Message processed.");
    } catch (error) {
        console.error("Error handling webhook:", error.message);
        res.status(500).send("Internal Server Error");
    }
});

// Send a document as a reply
app.post("/send-document", async (req, res) => {
    try {
        const { to, documentUrl, caption } = req.body;

        await axios.post(
            `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to,
                type: "document",
                document: {
                    link: documentUrl,
                    caption: caption || "Here is the document you requested.",
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                    "Content-Type": "application/json",
                },
            }
        );

        res.status(200).send("Document sent.");
    } catch (error) {
        console.error("Error sending document:", error.message);
        res.status(500).send("Internal Server Error");
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
