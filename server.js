import express from 'express';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import { catalogManager } from './catalog-manager.js';
import cron from 'node-cron';
import { Telegraf } from 'telegraf';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize catalog
catalogManager.init();

// Schedule catalog update once a week (Sundays at 00:00)
cron.schedule('0 0 * * 0', () => {
    console.log('Running weekly catalog update...');
    catalogManager.updateCatalog();
});

const DEFAULT_CONFIG = {
    storeName: "Двери Екатеринбурга",
    operator: {
        phone: "+7 (999) 340-62-15",
        email: "office@dveri-ekat.ru",
        workHours: "Пн-Пт: 10:00-20:00, Сб-Вс: 10:00-19:00"
    }
};

// Enable CORS for the store domain and self
app.use(cors({
    origin: '*', // For development, allow all. In production, we can restrict back.
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));
app.use('/docs', express.static(path.join(__dirname, 'docs')));

// Global request logger for debugging
app.use((req, res, next) => {
    console.log(`>>> [${new Date().toISOString()}] ${req.method} ${req.url}`);
    if (req.method === 'POST') {
        console.log('>>> Body keys:', Object.keys(req.body));
    }
    next();
});

// Catalog Search API
app.get('/api/search', (req, res) => {
    try {
        const { q } = req.query;
        console.log(`Searching for: "${q}"`);
        const results = catalogManager.search(q);
        console.log(`Found ${results.length} results.`);
        res.json(results);
    } catch (error) {
        console.error('Search API Internal Error:', error);
        res.status(500).json({ error: error.message });
    }
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
- Межкомнатных дверях (МДФ, массив, эмаль)
- Скрытых дверях (Invisible, под покраску)
- Фурнитуре (замки, ручки, петли)

Информация о магазине:
- На нашей выставке в салоне представлено более 400 моделей дверей. Это одна из самых больших экспозиций в Екатеринбурге.

Правила:
1. Отвечай только на вопросы о дверях и фурнитуре
2. Используй эмодзи для оформления (🚪🔒🔧💰✨)
3. Будь дружелюбным и профессиональным
4. При вопросах о заказе/доставке/точных ценах предлагай связаться с оператором
5. Отвечай на русском языке

Материалы для ответов:
${productsContext}

Контактная информация:
- Телефон: [${config.operator.phone}](tel:${config.operator.phone.replace(/[^\d+]/g, '')})
- Email: [${config.operator.email}](mailto:${config.operator.email})
- Часы работы: ${config.operator.workHours}
- Сайт: https://dveri-ekat.ru/
- Каталог: https://dveri-ekat.ru/collection/all
- Каталог: https://dveri-ekat.ru/collection/all

Инструкция по кнопкам навигации:
Если пользователь проявляет интерес к конкретной категории, ДОБАВЛЯЙ в конце своего ответа специальный тег [[NAV: тема]].
Темы:
- interior (межкомнатные двери)
- interior_white (белые двери/эмаль)
- entrance (входные/сейф-двери)
- hidden (скрытые двери)
- brands (бренды/производители)

Пример: "У нас большой выбор белых дверей. [[NAV: interior_white]]"
Обязательно используй именно этот формат. Не упоминай тег вслух, просто ставь его в конце.

История диалога:
${history.map(m => `${m.role === 'user' ? 'Клиент' : 'Консультант'}: ${m.content || m.text}`).join('\n')}
Клиент: ${userMessage}`;

    console.log(`>>> [AI]: Generating response for message: "${userMessage.substring(0, 50)}..."`);
    console.log(`>>> [AI]: Context length: ${productsContext.length}, History depth: ${history.length}`);

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemPrompt },
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

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT} `);
});

// Telegram Bot Integration
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (botToken) {
    const bot = new Telegraf(botToken);

    bot.start(async (ctx) => {
        const welcomeMessage = `Здравствуйте! 👋 Я виртуальный консультант магазина "Двери Екатеринбурга".\n\nЯ помогу вам выбрать межкомнатные или входные двери, фурнитуру и отвечу на вопросы об установке.\n\nВыберите интересующий раздел:`;
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🏠 Межкомнатные двери", url: "https://dveri-ekat.ru/collection/mezhkomnatnye-dveri" }],
                    [{ text: "🛡 Сейф-двери (Входные)", url: "https://dveri-ekat.ru/collection/seyf-dveri" }],
                    [{ text: "🫥 Скрытые двери", url: "https://dveri-ekat.ru/collection/skrytye-dveri" }],
                    [{ text: "📝 Записаться на замер", url: "https://dveri-ekat.ru/page/zamer" }]
                ]
            }
        };
        await ctx.reply(welcomeMessage, keyboard);
    });

    bot.on('text', async (ctx) => {
        const userMessage = ctx.message.text;

        try {
            // Simple typing indicator
            await ctx.sendChatAction('typing');

            // Search catalog for context
            const searchResults = catalogManager.search(userMessage);
            const productsContext = searchResults.map(p => {
                const brand = p.properties ? (p.properties['Изготовитель'] || p.properties['Производитель'] || '') : '';
                return `- ${p.title}: ${p.price} руб.${brand ? ' Бренд: ' + brand : ''} `;
            }).join('\n');

            // Generate AI response
            let aiResponse = await generateAIResponse(userMessage, [], productsContext);
            console.log(`AI Response for Telegram: "${aiResponse.substring(0, 100)}..."`);

            // Parse navigation tags for Telegram
            const navRegex = /\[\[NAV:\s*(.+?)\]\]/;
            const match = aiResponse.match(navRegex);
            let extra = {};

            if (match) {
                const theme = match[1].trim();
                aiResponse = aiResponse.replace(navRegex, '').trim();

                // Get buttons from knowledge base
                // Note: Since this is server-side, we need to make sure KNOWLEDGE_BASE is available
                // We'll import it or use a simplified map here if it's tricky.
                // Assuming it's already imported or available via a global/shared file.
                // For now, let's use a local map for reliability or better, import it.

                // Simplified inline keyboard generation
                const navButtons = {
                    "main_menu": [
                        [{ text: "🏠 Межкомнатные двери", url: "https://dveri-ekat.ru/collection/mezhkomnatnye-dveri" }],
                        [{ text: "🛡 Сейф-двери (Входные)", url: "https://dveri-ekat.ru/collection/seyf-dveri" }],
                        [{ text: "🫥 Скрытые двери", url: "https://dveri-ekat.ru/collection/skrytye-dveri" }],
                        [{ text: "📝 Записаться на замер", url: "https://dveri-ekat.ru/page/zamer" }]
                    ],
                    "interior": [
                        [{ text: "🏠 Межкомнатные двери", url: "https://dveri-ekat.ru/collection/mezhkomnatnye-dveri" }],
                        [{ text: "🛠 Фурнитура", url: "https://dveri-ekat.ru/collection/furnitura" }]
                    ],
                    "interior_white": [
                        [{ text: "⚪ Белые / Эмаль", url: "https://dveri-ekat.ru/collection/dveri-emal" }],
                        [{ text: "🚪 Весь каталог", url: "https://dveri-ekat.ru/collection/mezhkomnatnye-dveri" }]
                    ],
                    "entrance": [
                        [{ text: "🛡 Сейф-двери", url: "https://dveri-ekat.ru/collection/seyf-dveri" }],
                        [{ text: "📝 Записаться на замер", url: "https://dveri-ekat.ru/page/zamer" }]
                    ],
                    "brands": [
                        [{ text: "🏢 Фабрика ВФД", url: "https://dveri-ekat.ru/collection/vfd" }],
                        [{ text: "🛡 Аргус", url: "https://dveri-ekat.ru/collection/argus" }]
                    ],
                    "hidden": [
                        [{ text: "🫥 Скрытые двери", url: "https://dveri-ekat.ru/collection/skrytye-dveri" }]
                    ]
                };

                if (navButtons[theme]) {
                    extra = {
                        reply_markup: {
                            inline_keyboard: navButtons[theme]
                        }
                    };
                }
            }

            // Send response back to Telegram
            await ctx.reply(aiResponse, { parse_mode: 'Markdown', ...extra });
        } catch (error) {
            console.error('>>> [TELEGRAM BOT ERROR]:', error.message);
            if (error.response) {
                console.error('Telegram API Error Data:', JSON.stringify(error.response));
            }
            ctx.reply('Извините, произошла ошибка при обработке вашего сообщения. Попробуйте другой вопрос. 🛠');
        }
    });

    bot.launch()
        .then(() => console.log('>>> [TELEGRAM]: Bot is successfully polling for updates.'))
        .catch(err => {
            console.error('>>> [TELEGRAM ERROR]: Failed to launch bot:', err.message);
        });

    // Handle bot commands
    bot.command('status', (ctx) => ctx.reply('✅ Бот "Двери Екатеринбурга" работает и готов отвечать на вопросы!'));

    console.log('Telegram Bot logic initialized');

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
    console.warn('!!! [WARNING]: TELEGRAM_BOT_TOKEN not provided, skipping Telegram integration');
}
