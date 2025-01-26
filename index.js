require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const os = require("os");
const tempDir = os.tmpdir();
const { PDFDocument } = require("pdf-lib");
const AdmZip = require("adm-zip");



const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");

const app = express();
const PORT = 3000;

// Load environment variables
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_TOKEN;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// WhatsApp Webhook Verification
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.status(403).send("Verification failed.");
    }
});


const validatePdf = async (buffer) => {
    try {
        const pdfDoc = await PDFDocument.load(buffer);
        const pageCount = pdfDoc.getPageCount();
        if (pageCount === 0) {
            throw new Error("The PDF has no pages.");
        }
        console.log(`PDF validation successful. Number of pages: ${pageCount}`);
        return true;
    } catch (error) {
        console.error("PDF validation failed:", error.message);
        return false;
    }
};

const base64EncodePdf = (buffer) => Buffer.from(buffer).toString("base64");


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

        if (message.type === "document") {
            // Handle document message
            const documentId = message.document.id; // Media ID
            const documentName = message.document.filename;

            console.log(`Received document: ${documentName} from ${from}`);


            // Step 1: Get the media URL
            const mediaUrlResponse = await axios.get(
                `${WHATSAPP_API_URL}/${documentId}`,
                {
                    headers: {
                        Authorization: `Bearer ${ACCESS_TOKEN}`,
                    },
                }
            );

            if (!mediaUrlResponse.data.url) {
                throw new Error("Media URL not found in the response.");
            }

            const mediaUrl = mediaUrlResponse.data.url;
            console.log(`Media URL retrieved: ${mediaUrl}`);

            if (documentName.endsWith(".pdf")) {
                // Step 2: Fetch the document data as an array buffer
                const documentResponse = await axios.get(mediaUrl, {
                    headers: {
                        Authorization: `Bearer ${ACCESS_TOKEN}`,
                    },
                    responseType: "arraybuffer",
                }).catch((error) => {
                    console.error("Error fetching document from media URL:", error.message);
                    throw new Error("Failed to download document.");
                });

                // Step 3: Validate the Content-Type
                const contentType = documentResponse.headers['content-type'];
                if (contentType !== 'application/pdf') {
                    throw new Error(`Invalid file type: ${contentType}. Expected application/pdf.`);
                }

                const pdfBuffer = Buffer.from(documentResponse.data);

                // Step 4: Validate the PDF
                const isValidPdf = await validatePdf(pdfBuffer);
                if (!isValidPdf) {
                    throw new Error("The uploaded PDF is invalid or has no pages.");
                }

                // Step 4: Encode the PDF to base64
                const base64Pdf = base64EncodePdf(pdfBuffer);


                // Step 5: Send the base64-encoded document to Gemini
                const model = genAI.getGenerativeModel({ model: "models/gemini-1.5-flash" });

                const result = await model.generateContent([
                    {
                        inlineData: {
                            data: base64Pdf,
                            mimeType: "application/pdf",
                        },
                    },
                    "Please analyze this document and provide a summary of its main points.",
                ]);

                // Extract the summary safely
                const extractSummary = (response) => {
                    if (response.candidates && response.candidates.length > 0) {
                        const candidate = response.candidates[0];
                        if (
                            candidate.content &&
                            candidate.content.parts &&
                            candidate.content.parts.length > 0 &&
                            candidate.content.parts[0].text
                        ) {
                            return candidate.content.parts[0].text;
                        }
                    }
                    return "No summary could be generated.";
                };

                // Log the response for debugging
                console.log("Gemini API Response:", JSON.stringify(result.response, null, 2));

                // Extract the summary
                const summary = extractSummary(result.response);
                console.log("Extracted Summary:", summary);

                // Step 6: Send summary back to the user
                await axios.post(
                    `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
                    {
                        messaging_product: "whatsapp",
                        to: from,
                        text: { body: `Here is the summary of the document you sent:\n\n${summary}` },
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${ACCESS_TOKEN}`,
                            "Content-Type": "application/json",
                        },
                    }
                );

                console.log("Summary sent back to user:", from);

            } else if (documentName.endsWith(".zip")) {
                // Step 2: Fetch the .zip file
                const zipResponse = await axios.get(mediaUrl, {
                    headers: {
                        Authorization: `Bearer ${ACCESS_TOKEN}`,
                    },
                    responseType: "arraybuffer", // Download as binary data
                }).catch((error) => {
                    console.error("Error fetching .zip file:", error.message);
                    throw new Error("Failed to download .zip file.");
                });

                const zipBuffer = Buffer.from(zipResponse.data);

                // Step 3: Extract the .txt file from the .zip
                const zip = new AdmZip(zipBuffer);
                const zipEntries = zip.getEntries();

                let chatText = null;
                for (const entry of zipEntries) {
                    if (entry.entryName.endsWith(".txt")) {
                        chatText = zip.readAsText(entry);
                        console.log(`Extracted .txt file: ${entry.entryName}`);
                        break;
                    }
                }

                if (!chatText) {
                    throw new Error("No .txt file found in the .zip archive.");
                }

                console.log("Chat content extracted:", chatText.slice(0, 200)); // Log the first 200 characters

                // Step 4: Pass the chat text to Gemini for summarization
                const model = genAI.getGenerativeModel({ model: "models/gemini-1.5-flash" });

                const result = await model.generateContent([
                    chatText,
                    "Please provide a concise summary of this WhatsApp chat.",
                ]);

                // Extract the summary safely
                const extractSummary = (response) => {
                    if (response.candidates && response.candidates.length > 0) {
                        const candidate = response.candidates[0];
                        if (
                            candidate.content &&
                            candidate.content.parts &&
                            candidate.content.parts.length > 0 &&
                            candidate.content.parts[0].text
                        ) {
                            return candidate.content.parts[0].text;
                        }
                    }
                    return "No summary could be generated.";
                };

                // Log the response for debugging
                console.log("Gemini API Response:", JSON.stringify(result.response, null, 2));

                // Extract the summary
                const summary = extractSummary(result.response);
                console.log("Extracted Summary:", summary);


                // Step 5: Send the summary back to WhatsApp
                await axios.post(
                    `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
                    {
                        messaging_product: "whatsapp",
                        to: from,
                        text: { body: `Here is the summary of the chat you sent:\n\n${summary}` },
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${ACCESS_TOKEN}`,
                            "Content-Type": "application/json",
                        },
                    }
                );

                console.log("Summary sent back to user.");
            }
        }
        else if (message.type === "text") {
            // Handle text message
            const text = message.text?.body || "";
            console.log(`Received message: "${text}" from ${from}`);

            // Generate a reply using Gemini API
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

            const prompt = text;

            const result = await model.generateContent(prompt);

            const botReply = result.response.text() || "I'm not sure how to respond to that.";

            // Send the reply back to the user
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

            console.log("Text reply sent back to user:", from);
        } else {
            console.log("Unsupported message type received.");
        }

        res.status(200).send("Message processed.");
    } catch (error) {
        console.error("Error handling webhook:", error.response?.data || error.message);
        res.status(500).send("Internal Server Error");
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
