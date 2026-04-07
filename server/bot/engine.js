const axios = require('axios');
const { parseAdvancedNLP } = require('../utils/advancedNLP');
const { translations } = require('../data/translations');
const { fetchDynamicMenu } = require('./menuService');

const sessions = {};

function getSession(from) {
    if (!sessions[from]) {
        sessions[from] = {
            step: 'welcome',
            cart: [],
            language: 'en',
            lastMenu: null
        };
    }
    return sessions[from];
}

async function processMessage(from, text, name = 'Valued Customer') {
    // 1. Core Session & Menu Metadata
    const session = getSession(from);
    const menu = await fetchDynamicMenu();
    const lowerText = text.toLowerCase().trim();

    console.log(`🤖 Processing for ${from} (${name}): "${text}"`);

    // Helper to generate dynamic link with user data
    const getLink = (branchId) => {
        const baseUrl = "https://joana-web-whastapp-bot-production.up.railway.app/menu";
        const params = new URLSearchParams({
            branch_id: branchId,
            wa_name: name,
            wa_phone: from
        });
        return `${baseUrl}?${params.toString()}`;
    };

    // 2. Handle Interactive Button IDs directly (Fast-path)
    if (lowerText === 'feedback_satisfied') {
        session.step = 'FEEDBACK_POSITIVE';
        return ["We're so glad you're happy! 😊 Which item did you like the most? We value your feedback! 🍔🍟"];
    }
    if (lowerText === 'feedback_unsatisfied') {
        session.step = 'FEEDBACK_NEGATIVE';
        return ["We're sorry to hear that. 😞 Which item did you not like? Please let us know so we can improve."];
    }

    if (lowerText === 'branch_1') {
        return [
            `📍 *Downtown Riyadh*\nGreat choice, ${name}! You can view the menu and order here:\n${getLink('550e8400-e29b-41d4-a716-446655440001')}`,
            "Feel free to ask me if you want to order something specific via chat too! 🍟"
        ];
    }
    if (lowerText === 'branch_2') {
        return [
            `📍 *Jeddah Corniche*\nExcellent, ${name}! Explore our Jeddah menu here:\n${getLink('550e8400-e29b-41d4-a716-446655440002')}`,
            "I'm here if you need help with your order! 🥤"
        ];
    }
    if (lowerText === 'branch_3') {
        return [
            `📍 *Dammam Seafront*\nWonderful choice, ${name}! Check out our Dammam branch here:\n${getLink('550e8400-e29b-41d4-a716-446655440003')}`,
            "Let me know if you'd like to see our specials! 🍦"
        ];
    }

    // 3. AI Natural Language Processing (Groq)
    try {
        const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_1;
        if (!apiKey) throw new Error("Missing GROQ_API_KEY in environment");

        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.1-8b-instant",
            messages: [
                {
                    role: "system",
                    content: `You are JOANA, a polite and professional AI assistant for JOANA restaurant. 
                    - Customer Name: ${name} (Address them by name if they greet you).
                    - Current Context: ${session.step} (Use this to understand if the user is giving feedback).
                    - Your task is to greet customers and guide them to order.
                    - IMPORTANT: Do NOT give manual ordering instructions like "Visit our website" or "Select from a dropdown". 
                    - ALWAYS tell the user to "Simply select your branch below to start your order instantly."
                    
                    - FEEDBACK HANDLING:
                      - IF Context is 'FEEDBACK_POSITIVE': The user just said they are satisfied. They are likely naming an item they liked. Acknowledge it with a very warm "Thank you! I'm so glad you enjoyed the [Item]! We'll let our chefs know! 🍔🌟". Follow with "See you soon at JOANA!".
                      - IF Context is 'FEEDBACK_NEGATIVE': The user is unsatisfied. They are naming an item they didn't like. Be extremely polite and apologetic: "We're truly sorry the [Item] wasn't to your liking. We value this feedback and will work hard to improve it! 🙏".
                    
                    - SPECIAL RESPONSES:
                      - If user says "Welcome" or "You're welcome", respond with "Have a wonderful day! 😊" and do NOT suggest ordering.
                    
                    - STRICT RESTRICTION: Do not answer questions about recipes, medical advice, emergencies, or non-restaurant topics. 
                    - Keep responses friendly, warm, and very concise.`
                },
                { role: "user", content: text }
            ],
            temperature: 0.5
        }, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });

        const aiResponse = response.data.choices[0].message.content;

        // Reset feedback step after processing if we were in a feedback state
        if (session.step === 'FEEDBACK_POSITIVE' || session.step === 'FEEDBACK_NEGATIVE') {
            session.step = 'welcome';
        }

        // Determine if we should show branch buttons
        const isWelcome = /welcome/i.test(lowerText);
        const showButtons = !isWelcome && /hi|hello|hey|order|hungry|food|branch|start|menu|listen|excuse|how/i.test(text + " " + aiResponse);

        if (showButtons) {
            return [
                aiResponse,
                {
                    type: 'button',
                    body: "Please select a branch to explore our menu and order directly from our website:",
                    buttons: [
                        { id: 'branch_1', title: 'Downtown Riyadh' },
                        { id: 'branch_2', title: 'Jeddah Corniche' },
                        { id: 'branch_3', title: 'Dammam Seafront' }
                    ]
                }
            ];
        }

        return [aiResponse];

    } catch (error) {
        if (error.response) {
            console.error("❌ Groq AI Error Details:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("❌ Groq AI Error:", error.message);
        }
        // Fallback to simple matching if AI fails
        return [
            `👋 Welcome to JOANA, ${name}! 🍔\nExperience the future of dining with our AI-curated menu of premium culinary delights.`,
            {
                type: 'button',
                body: "Please select a branch to explore our menu and order directly from our website:",
                buttons: [
                    { id: 'branch_1', title: 'Downtown Riyadh' },
                    { id: 'branch_2', title: 'Jeddah Corniche' },
                    { id: 'branch_3', title: 'Dammam Seafront' }
                ]
            }
        ];
    }
}

function resetSession(from) {
    if (sessions[from]) {
        sessions[from].cart = [];
        sessions[from].step = 'welcome';
        console.log(`🧹 Session reset for ${from}`);
    }
}

module.exports = {
    processMessage,
    getSession,
    resetSession
};
