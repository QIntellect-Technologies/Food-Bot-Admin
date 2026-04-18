const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const FormData = require('form-data');
const dotenv = require('dotenv');
const botEngine = require('./bot/engine');
const { supabase } = require('./lib/supabase');

// Provide multiple explicit paths for Docker and Local fallback
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || 'joana-verify-token-123';

console.log('--- Server Startup ---');
console.log('PORT:', PORT);
console.log('WHATSAPP_ACCESS_TOKEN loaded:', WHATSAPP_ACCESS_TOKEN ? '✅ Yes' : '❌ No');
console.log('VERIFY_TOKEN loaded:', VERIFY_TOKEN ? '✅ Yes' : '❌ No');
console.log('----------------------');

// GET /webhook - Verification for Meta
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('--- Webhook Verification Request ---');
    console.log('Mode:', mode);
    console.log('Token received:', token);
    console.log('Expected Token:', VERIFY_TOKEN);

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('✅ WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            console.error('❌ VERIFICATION_FAILED - Token Mismatch');
            res.status(403).send('Verification failed: Token mismatch');
        }
    } else {
        console.error('❌ VERIFICATION_FAILED - Missing parameters');
        res.status(400).send('Verification failed: Missing parameters');
    }
});


// POST /webhook - WhatsApp webhook with backend bot engine integration
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object) {
        if (
            body.entry &&
            Array.isArray(body.entry) &&
            body.entry[0].changes &&
            Array.isArray(body.entry[0].changes) &&
            body.entry[0].changes[0].value
        ) {
            const value = body.entry[0].changes[0].value;

            // Handle Asynchronous Delivery Statuses (Read/Delivered/Failed)
            if (value.statuses && Array.isArray(value.statuses)) {
                const status = value.statuses[0];
                const msgId = status.id;
                const statusType = status.status; // 'delivered', 'read', 'failed'

                console.log(`✔️ Message status update: ${statusType} for ${status.recipient_id} (ID: ${msgId})`);

                // If message is 'read' or 'delivered', we update campaign stats
                if (statusType === 'read' || statusType === 'delivered') {
                    try {
                        const { data: mapping } = await supabase.from('campaign_message_logs').select('campaign_id').eq('message_id', msgId).single();
                        if (mapping) {
                            const column = statusType === 'read' ? 'read_count' : 'delivered_count';
                            // Using a simple update for now, ideally an RPC for atomicity
                            const { data: campaign } = await supabase.from('campaign_analytics').select(column).eq('id', mapping.campaign_id).single();
                            if (campaign) {
                                await supabase.from('campaign_analytics').update({ [column]: (campaign[column] || 0) + 1 }).eq('id', mapping.campaign_id);
                            }
                        }
                    } catch (err) {
                        console.error(`❌ Failed to update ${statusType} status:`, err.message);
                    }
                }

                if (statusType === 'failed') {
                    console.error('⚠️ WHATSAPP DELIVERY FAILED asynchronously!');
                    console.error('Recipient:', status.recipient_id);
                    console.error('Error Details:', JSON.stringify(status.errors));
                }
                return res.sendStatus(200);
            }

            // Process Incoming Messages
            if (value.messages && Array.isArray(value.messages)) {
                const message = value.messages[0];
                const from = message.from;
                const messageId = message.id;
                let msgBody = '';

                // Mark as Read (Blue Tick)
                try {
                    await axios.post(
                        `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
                        {
                            messaging_product: "whatsapp",
                            status: "read",
                            message_id: messageId
                        },
                        { headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}` } }
                    );
                } catch (readErr) {
                    console.error("❌ Failed to mark message as read:", readErr.message);
                }

                if (message.type === 'text') {
                    msgBody = message.text.body;
                } else if (message.type === 'interactive' && message.interactive.button_reply) {
                    msgBody = message.interactive.button_reply.id;
                } else if (message.type === 'audio') {
                    console.log("🎤 Audio message received. ID:", message.audio.id);

                    // 1. TRY REAL TRANSCRIPTION
                    try {
                        const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
                        const isGroq = !!process.env.GROQ_API_KEY;

                        if (apiKey) {
                            console.log(`🎤 Fetching WhatsApp media metadata for ID: ${message.audio.id}...`);
                            // Fetch Media URL from WhatsApp
                            const mediaResponse = await axios.get(
                                `https://graph.facebook.com/v18.0/${message.audio.id}`,
                                { headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}` } }
                            );

                            const mediaUrl = mediaResponse.data.url;
                            console.log("📥 Downloading audio binary from WhatsApp...");

                            // Download Audio Binary
                            const audioData = await axios.get(mediaUrl, {
                                headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}` },
                                responseType: 'arraybuffer'
                            });

                            console.log(`✅ Downloaded ${audioData.data.byteLength} bytes. Transcribing via ${isGroq ? 'Groq' : 'OpenAI'}...`);

                            // Create FormData for Whisper API
                            const form = new FormData();
                            form.append('file', Buffer.from(audioData.data), { filename: 'audio.ogg', contentType: 'audio/ogg' });

                            const model = isGroq ? 'whisper-large-v3' : 'whisper-1';
                            form.append('model', model);

                            // Guidance prompt based on current user language
                            const session = botEngine.getSession(from);
                            const userLang = session ? (session.language || 'en') : 'en';
                            const prompt = userLang === 'en'
                                ? "Transcribe in English."
                                : "Transcribe in Arabic.";
                            form.append('prompt', prompt);

                            const transcribeUrl = isGroq
                                ? 'https://api.groq.com/openai/v1/audio/transcriptions'
                                : 'https://api.openai.com/v1/audio/transcriptions';

                            console.log(`🤖 Sending to ${isGroq ? 'Groq' : 'OpenAI'} API...`);
                            const response = await axios.post(transcribeUrl, form, {
                                headers: {
                                    ...form.getHeaders(),
                                    'Authorization': `Bearer ${apiKey.trim()}`
                                }
                            });

                            msgBody = (response.data.text || "").trim();
                            console.log("Real Transcription:", msgBody);

                            // GUARD: Check for empty results
                            if (!msgBody) {
                                throw new Error("Whisper returned empty transcription");
                            }

                            // GUARD: Check for unsupported scripts
                            const allowedPattern = /[a-zA-Z0-9\u0600-\u06FF\s.,!?;:'"-]/g;
                            const cleaned = msgBody.replace(allowedPattern, "");
                            if (cleaned.length > msgBody.length * 0.2 && msgBody.length > 5) {
                                console.log("⚠️ REJECTED: Unsupported language detected:", msgBody);
                                throw new Error("Unsupported language detected. Please speak English or Arabic.");
                            }

                            // GUARD: Hallucinated repetitions
                            if (msgBody.length > 30) {
                                const words = msgBody.split(/\s+/);
                                if (words.length > 10) {
                                    const wordCounts = {};
                                    words.forEach(w => wordCounts[w] = (wordCounts[w] || 0) + 1);
                                    const mostCommonWord = Object.keys(wordCounts).reduce((a, b) => wordCounts[a] > wordCounts[b] ? a : b);
                                    if (wordCounts[mostCommonWord] > words.length * 0.5) {
                                        console.log("⚠️ REJECTED: Repetitive hallucination:", msgBody);
                                        throw new Error("Voice unclear (repetitive hallucination)");
                                    }
                                }
                            }

                            // Feedback for Real Transcription
                            const feedbackUrl = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
                            await axios.post(feedbackUrl, {
                                messaging_product: 'whatsapp',
                                to: from,
                                text: { body: `🎤 You said: "${msgBody}"` }
                            }, { headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } });

                        } else {
                            throw new Error("API Key (Groq/OpenAI) missing for transcription.");
                        }
                    } catch (error) {
                        console.error("Transcription failed:", error.message);
                        const errorMsg = error.message.includes("Unsupported language") || error.message.includes("Voice unclear")
                            ? `⚠️ ${error.message}`
                            : "⚠️ Sorry, I couldn't understand your voice message. Please try speaking more clearly or type your order.";

                        try {
                            const feedbackUrl = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
                            await axios.post(feedbackUrl, {
                                messaging_product: 'whatsapp',
                                to: from,
                                text: { body: errorMsg }
                            }, { headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } });
                        } catch (sendErr) {
                            console.error("Failed to send error feedback:", sendErr.message);
                        }
                        return res.sendStatus(200);
                    }
                }

                // Extract sender name for personalization
                const name = value.contacts && value.contacts[0] ? value.contacts[0].profile.name : 'Valued Customer';

                // Use backend bot engine to process message
                const replies = await botEngine.processMessage(from, msgBody, name);

                for (const reply of replies) {
                    const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
                    try {
                        let payload;
                        if (reply && typeof reply === 'object' && reply.type === 'button') {
                            payload = {
                                messaging_product: 'whatsapp',
                                to: from,
                                type: 'interactive',
                                interactive: {
                                    type: 'button',
                                    body: { text: reply.body },
                                    action: {
                                        buttons: reply.buttons.slice(0, 3).map((btn, idx) => ({
                                            type: 'reply',
                                            reply: {
                                                id: btn.id || `btn_${idx + 1}`,
                                                title: btn.title
                                            }
                                        }))
                                    }
                                }
                            };
                        } else if (reply && typeof reply === 'object' && reply.type === 'image') {
                            payload = {
                                messaging_product: 'whatsapp',
                                to: from,
                                type: 'image',
                                image: {
                                    link: reply.link
                                }
                            };
                        } else {
                            payload = {
                                messaging_product: 'whatsapp',
                                to: from,
                                text: { body: reply }
                            };
                        }
                        console.log(`📤 Sending message to ${from}...`);
                        console.log('📦 Payload:', JSON.stringify(payload, null, 2));

                        const response = await axios.post(
                            url,
                            payload,
                            {
                                headers: {
                                    'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                                    'Content-Type': 'application/json'
                                }
                            }
                        );
                        console.log(`✅ Message accepted by Meta! Message ID: ${response.data.messages[0].id}`);
                        await new Promise(resolve => setTimeout(resolve, 800));
                    } catch (error) {
                        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
                        console.error('❌ Error sending WhatsApp reply!');
                        console.error('👉 Target URL:', url.replace(WHATSAPP_ACCESS_TOKEN, '***'));
                        console.error('👉 Error Details:', errorDetails);

                    } // End try-catch
                } // End for-loop
            } // End if (value.messages)

            res.sendStatus(200); // Acknowledge the webhook event
        } else {
            res.sendStatus(404); // Unknown structure within valid object
        }
    } else {
        res.sendStatus(404); // Not a WhatsApp API event
    }
});

// Order Receipt API (Web Frontend calls this)
app.post('/api/send-receipt', async (req, res) => {
    const { phone, name, items, total, orderId, orderNumber, subtotal, discount, deliveryFee, branchName } = req.body;
    if (!phone || !items || !total) return res.status(400).send('Missing order data');

    const formattedItems = items.map(i => `• ${i.qty}x ${i.name} (SAR ${i.price})`).join('\n');
    const displayId = orderNumber || orderId?.slice(0, 8) || 'WEB';
    const locName = branchName || "JOANA";

    // Breakdown Formatting
    const sTotal = Number(subtotal || total - (deliveryFee || 0)).toFixed(2);
    const dFee = Number(deliveryFee || 0).toFixed(2);
    const disc = Number(discount || 0).toFixed(2);
    const fTotal = Number(total).toFixed(2);

    let receiptText = `✅ *ORDER CONFIRMED!* 🍔\n\nThank you, *${name}*! Your order at *${locName}* has been received.\n\n📝 *Order details:* #${displayId}\n${formattedItems}\n\n`;
    receiptText += `▫️ *Subtotal:* SAR ${sTotal}\n`;
    if (Number(disc) > 0) receiptText += `🎁 *Discount:* -SAR ${disc}\n`;
    receiptText += `🚚 *Delivery Fee:* SAR ${dFee}\n`;
    receiptText += `💰 *Total Amount:* *SAR ${fTotal}*\n\n`;
    receiptText += `🕒 Your order will be ready in approximately *15 minutes*.\n\nThank you for choosing *JOANA ${locName}*! We are delighted to serve you. 🍴✨`;

    // Reset WhatsApp session...
    botEngine.resetSession(phone);

    const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    try {
        await axios.post(url, {
            messaging_product: 'whatsapp',
            to: phone,
            type: 'text',
            text: { body: receiptText }
        }, { headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } });

        console.log(`✅ Receipt sent to ${phone}`);

        // Schedule feedback message (1 minute later)
        setTimeout(async () => {
            try {
                const feedbackText = `Hi ${name}! We hope you enjoyed your meal. 😊\n\nHow was your experience with JOANA today?`;
                await axios.post(url, {
                    messaging_product: 'whatsapp',
                    to: phone,
                    type: 'interactive',
                    interactive: {
                        type: 'button',
                        body: { text: feedbackText },
                        action: {
                            buttons: [
                                { type: 'reply', reply: { id: 'feedback_satisfied', title: 'Satisfied 😊' } },
                                { type: 'reply', reply: { id: 'feedback_unsatisfied', title: 'Not Satisfied 😞' } }
                            ]
                        }
                    }
                }, { headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } });
                console.log(`✅ Interactive feedback sent to ${phone}`);
            } catch (err) {
                console.error('❌ Delayed feedback failed:', err.message);
            }
        }, 60000);

        res.status(200).send('Receipt queued');
    } catch (error) {
        console.error('❌ Error sending receipt:', error.response ? error.response.data : error.message);
        res.status(500).send('WhatsApp delivery failed');
    }
});

// Promotional Campaign API
app.post('/api/send-campaign', async (req, res) => {
    const { audience, message, type, branchId, campaignName } = req.body;

    if (!message || !audience) {
        return res.status(400).send('Missing campaign data');
    }

    console.log(`📣 BROADCAST START: Name=${campaignName || 'Unnamed'}, Target=${audience}`);

    try {
        // 1. Create Campaign Analytics Entry
        const { data: campaign, error: campErr } = await supabase.from('campaign_analytics').insert({
            name: campaignName || `Campaign ${new Date().toLocaleDateString()}`,
            audience: audience,
            message: message,
            branch_id: branchId,
            status: 'Active',
            sent_count: 0,
            delivered_count: 0,
            read_count: 0,
            click_count: 0,
            respond_count: 0
        }).select().single();

        if (campErr) throw campErr;

        let targets = [];

        // Resolve Audience to Phone Numbers
        if (audience === 'ALL_USERS') {
            const { data } = await supabase.from('profiles').select('phone').eq('role', 'customer');
            targets = data || [];
        } else if (audience === 'NEW_USERS') {
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const { data } = await supabase.from('profiles').select('phone').eq('role', 'customer').gte('created_at', sevenDaysAgo);
            targets = data || [];
        } else if (audience.startsWith('INACTIVE_')) {
            const days = parseInt(audience.split('_')[1]);
            const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
            const { data } = await supabase.from('customers').select('phone').lt('last_interaction', cutoff);
            targets = data || [];
        } else if (audience.startsWith('USER:')) {
            const userId = audience.split(':')[1];
            const { data } = await supabase.from('profiles').select('phone').eq('id', userId).single();
            if (data) targets = [data];
        }

        const phoneNumbers = [...new Set(targets.map(t => t.phone).filter(p => !!p))];
        console.log(`👥 Found ${phoneNumbers.length} unique target(s)`);

        // Update sent count
        await supabase.from('campaign_analytics').update({ sent_count: phoneNumbers.length }).eq('id', campaign.id);

        // 2. Prepare tracking link (Local shortcut)
        const trackingUrl = `https://${req.get('host')}/api/c/${campaign.id}`;
        const finalMessage = `${message}\n\n👉 Order Now: ${trackingUrl}`;

        // 3. Send WhatsApp Messages (Meta API)
        const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

        for (const phone of phoneNumbers) {
            try {
                const response = await axios.post(url, {
                    messaging_product: 'whatsapp',
                    to: phone,
                    type: 'text',
                    text: { body: finalMessage }
                }, { headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } });

                const messageId = response.data.messages[0].id;

                // Log message ID for tracking
                await supabase.from('campaign_message_logs').insert({
                    campaign_id: campaign.id,
                    message_id: messageId,
                    recipient: phone
                });

                console.log(`✅ Campaign msg sent to ${phone} (ID: ${messageId})`);
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (err) {
                console.error(`❌ Failed to send to ${phone}:`, err.response?.data || err.message);
            }
        }

        res.status(200).send({ success: true, count: phoneNumbers.length, campaignId: campaign.id });
    } catch (error) {
        console.error('❌ Campaign broadcast failed:', error);
        res.status(500).send('Broadcast failed');
    }
});

// Campaign Click Tracking Redirect
app.get('/api/c/:campaignId', async (req, res) => {
    const { campaignId } = req.params;
    try {
        const { data: campaign } = await supabase.from('campaign_analytics').select('click_count').eq('id', campaignId).single();
        if (campaign) {
            await supabase.from('campaign_analytics').update({ click_count: (campaign.click_count || 0) + 1 }).eq('id', campaignId);
        }
    } catch (err) {
        console.error('❌ Click tracking failed:', err.message);
    }
    // Redirect to public menu
    res.redirect('/');
});

app.get('/config.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`window.ENV = { VITE_SUPABASE_URL: "${process.env.VITE_SUPABASE_URL || ''}", VITE_SUPABASE_ANON_KEY: "${process.env.VITE_SUPABASE_ANON_KEY || ''}" };`);
});

// Serve Static Files
const publicMenuDist = path.join(__dirname, '../public-menu/dist');
const adminPanelDist = path.join(__dirname, '../dist');

// 1. Unified Route Handling for /menu
// If accessed as /menu (no slash), redirect to /menu/ for correct relative asset loading
app.get('/menu', (req, res) => res.redirect('/menu/'));

// Public Menu - serve static files and SPA fallback at /menu/
// app.use handles all sub-paths without any wildcard syntax
app.use('/menu', express.static(publicMenuDist));

// SPA fallback: serve index.html for any /menu sub-route not matched by static files
// Using app.use avoids ALL path-to-regexp wildcard issues
app.use('/menu', (req, res) => {
    res.sendFile(path.join(publicMenuDist, 'index.html'));
});

// 2. Serve Admin Panel at root /
app.use(express.static(adminPanelDist));

// 3. Catch-all to serve Admin Panel index.html (SPA support)
app.use((req, res) => {
    if (require('fs').existsSync(path.join(adminPanelDist, 'index.html'))) {
        res.sendFile(path.join(adminPanelDist, 'index.html'));
    } else {
        res.status(404).send('Frontend not built yet. Run npm run build first.');
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
