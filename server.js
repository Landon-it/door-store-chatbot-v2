import express from 'express';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import { catalogManager } from './catalog-manager.js';
import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import nodemailer from 'nodemailer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

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

// Email transporter configuration
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_PORT == 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

async function sendLeadEmail(leadData) {
    // Email sending is currently disabled per user request.
    // We log the attempt for debugging purposes.
    console.log('>>> [Email Debug]: Lead capture triggered (Email sending is currently DISABLED)');
    console.log('>>> [Email Debug]: Data that would be sent:', JSON.stringify(leadData, null, 2));
    return true;
}

// Telegram Admin Notification
async function notifyAdmin(message) {
    if (!ADMIN_TELEGRAM_ID || !TELEGRAM_BOT_TOKEN) {
        console.warn('>>> [Notification]: Skipping Telegram admin notify (Missing ADMIN_TELEGRAM_ID or TELEGRAM_BOT_TOKEN)');
        return;
    }

    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: ADMIN_TELEGRAM_ID, text: message, parse_mode: 'HTML' })
        });
        const data = await res.json();
        if (data.ok) {
            console.log('>>> [Notification]: Admin notified via Telegram');
        } else {
            console.error('>>> [Notification Error]: Telegram API returned error:', data.description);
        }
    } catch (e) {
        console.error('>>> [Notification Error]:', e.message);
    }
}

// In-memory sessions for Telegram (stores history by chatId)
const tgSessions = {};

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

    let systemPrompt = `Ты - виртуальный консультант магазина "${config.storeName}".
СТРОГОЕ ПРАВИЛО ЯЗЫКА:
- Пиши ТОЛЬКО на русском языке.
- Используй только кириллицу, латиницу (для ссылок и брендов) и эмодзи.
- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать иероглифы (китайские, японские и др.), арабскую вязь или любые другие непонятные символы. Если сомневаешься в слове — не используй его.

Специализация:
- Входные двери (металлические, деревянные, комбинированные)
- Межкомнатные двери (МДФ, массив, эмаль)
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
- Email: office@dveri-ekat.ru
- Часы работы: ${config.operator.workHours}
- Сайт: https://dveri-ekat.ru/
- Каталог: https://dveri-ekat.ru/collection/all

Инструкция по продажам и воронке:
Ты — проактивный менеджер-консультант. Твоя цель — ПОМОЧЬ клиенту с выбором и довести до ЗАМЕРА.
ПРАВИЛА ВОРОНКИ:
1. КВАЛИФИКАЦИЯ (НАЧАЛО):
   - В первых 2-3 сообщениях НЕ предлагай ссылки на конкретные товары.
   - Задавай уточняющие вопросы: "Куда подбираете (квартира/дом)?", "Какой стиль предпочитаете (классика/минимализм)?", "Сколько дверей нужно?".

2. ГИБКОСТЬ (FAST-TRACK):
   - Если клиент ворчит, проявляет нетерпение или отказывается отвечать (пишет "не хочу", "просто перезвоните", "зачем вам это"), НЕ НАСТАИВАЙ на опросе.
   - СРАЗУ предложи оставить только телефон: "Я вас понял, не буду мучить вопросами. Оставьте ваш номер телефона, и менеджер сам свяжется с вами для консультации".
   - Поблагодари клиента в любом случае.

3. ПРЕДЛОЖЕНИЕ (СЕРЕДИНА):
   - Только когда понятно (через 2-3 ответа пользователя), что нужно, предлагай ссылки на подходящие категории или товары.

4. ЗАВЕРШЕНИЕ (ЛИД):
   - Предложи замер как логичный следующий шаг. Обязательно скажи: "Оставьте ваше имя и телефон прямо здесь, я передам менеджеру".
   - Собери Имя, Телефон и Адрес (если клиент согласен). По окончании добавь тег [[LEAD: ...]].
   - Если клиент оставил только телефон (в Fast-Track), заполни в теге только поле phone, остальные ставь "-".
   - АНОНИМНЫЙ ЛИД: Если клиент категорически отказывается оставлять телефон и прощается/уходит, ОБЯЗАТЕЛЬНО поставь тег [[LEAD: {"name": "-", "phone": "-", "address": "-"}]] в самом конце последнего сообщения. Это нужно, чтобы менеджер знал, что был активный интерес без контактов.

ОБЩИЕ ПРАВИЛА:
- НИКОГДА не заканчивай ответ точкой. Всегда задавай наводящий вопрос (кроме этапа благодарности за лид или когда клиент уходит).
- У нас самая большая выставка в Екатеринбурге (более 400 моделей) на Базовом пер., 47.

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
            temperature: 0.6, // Немного снижаем температуру для большей стабильности
            max_tokens: 500
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Groq API error');
    }

    const data = await response.json();
    content = content.replace(/[^\u0400-\u04FF\u0020-\u007E\u00A0-\u00FF\u2000-\u2BFF\uD83C-\uDBFF\uDC00-\uDFFF\s]/g, '');

    if (content.includes('[[LEAD:')) {
        console.log('>>> [AI Debug]: Lead tag detected in raw content');
    }

    return content;
}

// Chat API handler (for web widget)
app.post('/api/chat', async (req, res) => {
    try {
        const { userMessage, history, productsContext, config } = req.body;
        let content = await generateAIResponse(userMessage, history, productsContext, config);

        // Check for lead tag
        const leadRegex = /\[\[LEAD:\s*({.+?})\]\]/;
        const leadMatch = content.match(leadRegex);
        if (leadMatch) {
            try {
                const leadData = JSON.parse(leadMatch[1]);

                let adminMsg;
                if (leadData.phone === '-' && leadData.name === '-') {
                    adminMsg = `<b>⚠️ АНОНИМНЫЙ ИНТЕРЕС (Web)</b>\n\nКто-то интересовался дверями на сайте, но не оставил контактов. Загляните в панель мониторинга!`;
                } else {
                    adminMsg = `<b>🚀 НОВЫЙ ЛИД (Web)</b>\n\n👤 Имя: ${leadData.name}\n📞 Тел: ${leadData.phone}\n🏠 Адрес: ${leadData.address}`;
                }

                await notifyAdmin(adminMsg);
                content = content.replace(leadRegex, (leadData.phone === '-' ? '\n\n✅ Спасибо за интерес! Если решите заказать замер, я всегда на связи.' : '\n\n✅ Ваша заявка отправлена менеджеру! Мы скоро свяжемся с вами.')).trim();
            } catch (e) { console.error('Lead parse error:', e); }
        }

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
                    [{ text: "🫥 Скрытые двери", url: "https://dveri-ekat.ru/collection/invisible" }],
                    [{ text: "📝 Записаться на замер", url: "https://dveri-ekat.ru/page/zamer" }]
                ]
            }
        };
        await ctx.reply(welcomeMessage, keyboard);
    });

    bot.command('myid', (ctx) => {
        ctx.reply(`Ваш Telegram ID: <code>${ctx.chat.id}</code>\nДобавьте его в .env как ADMIN_TELEGRAM_ID`, { parse_mode: 'HTML' });
    });

    bot.on('text', async (ctx) => {
        const chatId = ctx.chat.id;
        const userMessage = ctx.message.text;

        if (!tgSessions[chatId]) tgSessions[chatId] = [];

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
            let aiResponse = await generateAIResponse(userMessage, tgSessions[chatId], productsContext);
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
                        [{ text: "🫥 Скрытые двери", url: "https://dveri-ekat.ru/collection/invisible" }],
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
                        [{ text: "🧱 WestStyle", url: "https://dveri-ekat.ru/collection/weststyle" }],
                        [{ text: "🌌 Universe", url: "https://dveri-ekat.ru/collection/universe" }],
                        [{ text: "🎶 Гармония", url: "https://dveri-ekat.ru/collection/garmoniya" }],
                        [{ text: "🔄 Synergy", url: "https://dveri-ekat.ru/collection/sinerzhi-synergy" }],
                        [{ text: "🌳 Albero", url: "https://dveri-ekat.ru/collection/albero" }],
                        [{ text: "🏢 ВФД", url: "https://dveri-ekat.ru/collection/vladimirskaya-fabrika-dverey" }],
                        [{ text: "⭐ La Stella", url: "https://dveri-ekat.ru/collection/la-stella-la-stella" }],
                        [{ text: "🚪 Velldoris", url: "https://dveri-ekat.ru/collection/velldoris-velldoris" }],
                        [{ text: "🛠 Lidman", url: "https://dveri-ekat.ru/collection/lidman" }],
                        [{ text: "🛡 Аргус", url: "https://dveri-ekat.ru/collection/argus" }],
                        [{ text: "➕ Еще (весь каталог)", url: "https://dveri-ekat.ru/collection/all" }]
                    ],
                    "hidden": [
                        [{ text: "🫥 Скрытые двери", url: "https://dveri-ekat.ru/collection/invisible" }]
                    ],
                    "funnel_start": [
                        [{ text: "🏠 В квартиру", url: "https://dveri-ekat.ru/collection/mezhkomnatnye-dveri" }],
                        [{ text: "🏡 В частный дом", url: "https://dveri-ekat.ru/collection/seyf-dveri" }],
                        [{ text: "🏢 В офис", url: "https://dveri-ekat.ru/collection/all" }]
                    ],
                    "funnel_style": [
                        [{ text: "🏛 Классика", url: "https://dveri-ekat.ru/collection/all?options[70183][]=493201" }],
                        [{ text: "✨ Модерн / Хай-тек", url: "https://dveri-ekat.ru/collection/all?options[70183][]=493202" }],
                        [{ text: "🫥 Минимализм (Скрытые)", url: "https://dveri-ekat.ru/collection/invisible" }]
                    ],
                    "funnel_zamer": [
                        [{ text: "📏 Записаться на замер", url: "https://dveri-ekat.ru/page/zamer" }],
                        [{ text: "📞 Перезвоните мне", url: "https://dveri-ekat.ru/page/contacts" }]
                    ]
                };

                // Add persistent CTA buttons to almost every menu
                const stickyButtons = [
                    [{ text: "📝 Оставить заявку", callback_data: "leave_request" }],
                    [{ text: "📞 Позвонить нам", url: "tel:+73433170420" }]
                ];

                if (navButtons[theme]) {
                    extra = {
                        reply_markup: {
                            inline_keyboard: [...navButtons[theme], ...stickyButtons]
                        }
                    };
                }
            }

            // Handle Lead Tag in Telegram
            const leadMatch = aiResponse.match(leadRegex);
            if (leadMatch) {
                console.log('>>> [LEAD]: Tag match found for Telegram');
                try {
                    const leadData = JSON.parse(leadMatch[1]);
                    console.log('>>> [LEAD]: Data parsed:', leadData);
                    const sourceInfo = `TG (@${ctx.from.username || ctx.from.id})`;

                    let adminMsg;
                    if (leadData.phone === '-' && leadData.name === '-') {
                        adminMsg = `<b>⚠️ АНОНИМНЫЙ ИНТЕРЕС (${sourceInfo})</b>\n\nКто-то интересовался дверями, но не оставил контактов. Загляните в чат, возможно нужна ручная помощь!`;
                    } else {
                        adminMsg = `<b>🔥 НОВЫЙ ЛИД (${sourceInfo})</b>\n\n👤 Имя: ${leadData.name}\n📞 Тел: ${leadData.phone}\n🏠 Адрес: ${leadData.address}`;
                    }

                    await notifyAdmin(adminMsg);

                    aiResponse = aiResponse.replace(leadRegex, '\n\n✅ Ваша заявка передана менеджеру! Мы свяжемся с вами в ближайшее время.').trim();
                    tgSessions[chatId] = []; // Clear history after lead to prevent loops
                } catch (e) { console.error('TG Lead parse error:', e); }
            }

            // Warning about limit
            if (tgSessions[chatId].length === 25) {
                aiResponse += "\n\n⚠️ Обратите внимание: через 5 ответов я начну забывать начало нашего разговора, так как моя память ограничена.";
            }

            // Update session history
            tgSessions[chatId].push({ role: 'user', content: userMessage });
            tgSessions[chatId].push({ role: 'assistant', content: aiResponse });
            // Keep last 30 messages
            if (tgSessions[chatId].length > 30) tgSessions[chatId] = tgSessions[chatId].slice(-30);

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

    bot.command('status', (ctx) => ctx.reply('✅ Бот "Двери Екатеринбурга" работает и готов отвечать на вопросы!'));

    // Set persistent menu commands
    bot.telegram.setMyCommands([
        { command: 'start', description: 'Запустить бота / Главное меню' },
        { command: 'zamer', description: 'Записаться на замер' },
        { command: 'contacts', description: 'Наши контакты и адрес' },
        { command: 'myid', description: 'Узнать мой Telegram ID' }
    ]).catch(err => console.error('Failed to set commands:', err));

    bot.command('zamer', (ctx) => {
        ctx.reply('📏 Записаться на бесплатный замер можно по ссылке ниже или просто оставьте ваши данные прямо здесь в чате.', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🌐 Записаться на сайте", url: "https://dveri-ekat.ru/page/zamer" }],
                    [{ text: "📝 Оставить заявку в чате", callback_data: "leave_request" }]
                ]
            }
        });
    });

    bot.command('contacts', (ctx) => {
        ctx.reply('📍 Наш адрес: Екатеринбург, Базовый пер., 47 (у Леруа Мерлен)\n📞 Телефон: +7 (343) 317-04-20\n✉️ Email: office@dveri-ekat.ru', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🗺 Открыть карту", url: "https://yandex.ru/maps/-/CCUfE0X0~A" }]
                ]
            }
        });
    });

    bot.action('leave_request', (ctx) => {
        ctx.reply('Отлично! Для оформления заявки, пожалуйста, напишите как вас зовут?');
        // We could flag the session here, but the AI will handle "Я хочу оставить заявку" naturally
        // If we want to be explicit:
        // tgSessions[ctx.chat.id].push({ role: 'user', content: 'Я хочу оставить заявку' });
    });

    console.log('Telegram Bot logic initialized');

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
    console.warn('!!! [WARNING]: TELEGRAM_BOT_TOKEN not provided, skipping Telegram integration');
}
