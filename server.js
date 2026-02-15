import express from 'express';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import BitrixBot from './bitrix-bot.js';
import { catalogManager } from './catalog-manager.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize catalog
catalogManager.init();

const bitrixBot = new BitrixBot(
    process.env.BITRIX24_DOMAIN,
    process.env.BITRIX24_CLIENT_ID,
    process.env.BITRIX24_CLIENT_SECRET
);

const DEFAULT_CONFIG = {
    storeName: "Гардиан",
    operator: {
        phone: "8 (800) 555-35-35",
        email: "info@dveri-ekat.ru",
        workHours: "Пн-Пт 9:00 - 18:00"
    }
};

// Enable CORS for the store domain
app.use(cors({
    origin: ['https://dveri-ekat.ru', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/docs', express.static(path.join(__dirname, 'docs')));

// Catalog Search API
app.get('/api/search', (req, res) => {
    const { q } = req.query;
    const results = catalogManager.search(q);
    res.json(results);
});

// Root route to serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Core AI response generator
async function generateAIResponse(userMessage, history = [], productsContext = "", config = DEFAULT_CONFIG) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('API key not configured');

    let systemPrompt = `Ты - виртуальный консультант магазина "${config.storeName}". Ты специализируешься на:
- Входных дверях (металлические, деревянные, комбинированные)
- Межкомнатных дверях (МДФ, массив, стеклянные)
- Фурнитуре (замки, ручки, петли)

Правила:
1. Отвечай только на вопросы о дверях и фурнитуре
2. Используй эмодзи для оформления (🚪🔒🔧💰✨)
3. Будь дружелюбным и профессиональным
4. При вопросах о заказе/доставке/точных ценах предлагай связаться с оператором
5. Отвечай на русском языке
6. Используй легкий юмор (1 шутка на 3-4 сообщения)
7. Форматируй ответы с помощью HTML тегов: <strong>, <br> (для Bitrix24 используй обычные переносы строк если нужно)
8. ВАЖНО: НЕ задавай вопросы в конце КАЖДОГО ответа! Давай полезную информацию и заканчивай ответ естественно.
9. Делай ссылки кликабельными.
10. КРИТИЧНО: Давай КОРОТКИЕ и ЛАКОНИЧНЫЕ ответы! Максимум 3-5 предложений.`;

    if (productsContext) {
        systemPrompt += `\n\nВ нашем каталоге найдены подходящие товары:\n${productsContext}`;
    }

    systemPrompt += `\n\nКонтакты оператора:
📞 ${config.operator.phone}
📧 ${config.operator.email}
🕐 ${config.operator.workHours}`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemPrompt },
                ...history.map(msg => ({
                    role: msg.type === 'user' ? 'user' : 'assistant',
                    content: msg.text
                })),
                { role: 'user', content: userMessage }
            ],
            temperature: 0.7,
            max_tokens: 500
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Groq API error');
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// Chat API handler (for web widget)
app.post('/api/chat', async (req, res) => {
    try {
        const { userMessage, history, productsContext, config } = req.body;
        const content = await generateAIResponse(userMessage, history, productsContext, config);
        res.status(200).json({ content });
    } catch (error) {
        console.error('Chat Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Bitrix24 Webhook Handler
app.post('/api/bitrix/webhook', async (req, res) => {
    const event = req.body.event;
    const data = req.body.data;
    const auth = req.body.auth;

    // Acknowledge the webhook immediately
    res.status(200).send('');

    if (event === 'ONIMBOTMESSAGEADD') {
        const userMessage = data.PARAMS.MESSAGE;
        const chatId = data.PARAMS.DIALOG_ID;
        const botId = data.BOT_ID;

        try {
            // Search catalog for context
            const searchResults = catalogManager.search(userMessage);
            const productsContext = searchResults.map(p => `- ${p.title}: ${p.price} руб.`).join('\n');

            // Generate AI response
            let aiResponse = await generateAIResponse(userMessage, [], productsContext);

            // Remove HTML tags for Bitrix24 if any (Bitrix uses its own BB-codes or plain text)
            aiResponse = aiResponse.replace(/<[^>]*>?/gm, '');

            // Send back to Bitrix24
            await bitrixBot.sendMessage(botId, chatId, aiResponse, auth);
        } catch (error) {
            console.error('Bitrix24 Error:', error);
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
