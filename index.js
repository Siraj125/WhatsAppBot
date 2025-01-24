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
const GEMINI_TOKEN = process.env.GEMINI_TOKEN;

const { GoogleGenerativeAI } = require("@google/generative-ai");
// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// WhatsApp Webhook Verification
app.get("/webhook", (req, res) => {
    console.log("GET request received at /webhook");
    console.log("Query Parameters:", req.query);

    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token === process.env.VERIFY_TOKEN) {
        console.log("Verification successful!");
        res.status(200).send(challenge);
    } else {
        console.log("Verification failed!");
        res.status(403).send("Verification failed.");
    }
});


// WhatsApp Webhook Endpoint
app.post("/webhook", async (req, res) => {
    try {
        const body = req.body;

        // Extract message details
        const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (!message) {
            return res.status(400).send("No message received.");
        }

        const from = message.from; // Sender's WhatsApp ID
        const text = message.text?.body || ""; // Message content

        console.log(`Received message: "${text}" from ${from}`);
        console.log("Incoming payload:", JSON.stringify(req.body, null, 2));

        // Send message to Gemini API
        // const response = await axios.post(
        //     `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        //     {
        //         contents: [{
        //             parts: [{ text: text }]
        //         }]
        //     },
        //     {
        //         headers: {
        //             'Content-Type': 'application/json',
        //         }
        //     }
        // );




        const genAI = new GoogleGenerativeAI("AIzaSyDtoP-p7RLeKgfJJYgRJOq1m8DPamiXqqY");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = text;

        const result = await model.generateContent(prompt);
        console.log(result.response.text(), 'result. response. text');
        console.log(result ,'result')

        const botReply = result.response.text() || "I'm not sure how to respond to that.";

        // Respond to the user via WhatsApp API
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
