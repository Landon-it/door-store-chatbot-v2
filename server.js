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

// Initialize catalog (deferred to app.listen to avoid Render Timeout)
// catalogManager.init();

// Schedule catalog update once a week (Sundays at 00:00)
cron.schedule('0 0 * * 0', () => {
    console.log('Running weekly catalog update...');
    catalogManager.updateCatalog();
});

// Self-ping to keep Render awake (Every 10 minutes)
cron.schedule('*/10 * * * *', async () => {
    const URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    console.log(`>>> [KeepAlive]: Pinging ${URL}/health ...`);
    try {
        const res = await fetch(`${URL}/health`);
        if (res.ok) console.log('>>> [KeepAlive]: Ping success');
        else console.warn(`>>> [KeepAlive]: Ping failed with status ${res.status}`);
    } catch (e) {
        console.error(`>>> [KeepAlive]: Ping error: ${e.message}`);
    }
});

// Shared Regex Patterns
const navRegex = /\[\[NAV:\s*(.+?)\]\]/;
const leadRegex = /\[\[LEAD:\s*({.+?})\]\]/;

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
        console.log(`>>> [Notification]: Sending Telegram notify to ${ADMIN_TELEGRAM_ID}...`);
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: ADMIN_TELEGRAM_ID, text: message, parse_mode: 'HTML' })
        });
        const data = await res.json();
        if (data.ok) {
            console.log('>>> [Notification]: Admin notified via Telegram SUCCESSFULLY');
        } else {
            console.error('>>> [Notification Error]: Telegram API returned error:', data.description);
            console.error('>>> [Notification Error]: Attempted Chat ID:', ADMIN_TELEGRAM_ID);
        }
    } catch (e) {
        console.error('>>> [Notification Error]: Fetch/Network error:', e.message);
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

// Базовая авторизация (Basic Auth) для защиты веб-интерфейса
const AUTH_USER = process.env.AUTH_USER;
const AUTH_PASS = process.env.AUTH_PASS;

if (AUTH_USER && AUTH_PASS) {
    app.use((req, res, next) => {
        // Пропускаем API, вебхуки и health-check (чтобы бот продолжал работать на основном сайте и в ТГ)
        if (req.path.startsWith('/api/') || req.path.startsWith('/telegraf/') || req.path === '/health') {
            return next();
        }

        const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
        const [login, ...passwordParts] = Buffer.from(b64auth, 'base64').toString().split(':');
        const password = passwordParts.join(':');

        if (login && password && login === AUTH_USER && password === AUTH_PASS) {
            return next();
        }

        res.set('WWW-Authenticate', 'Basic realm="Bot Secure Panel"');
        res.status(401).send('Требуется авторизация');
    });
} else {
    console.warn('[Security] Переменные AUTH_USER и AUTH_PASS не заданы. Демо-интерфейс открыт для всех!');
}

app.use(express.static(path.join(__dirname, 'public')));
app.use('/docs', express.static(path.join(__dirname, 'docs')));

// Global request logger for debugging
app.use((req, res, next) => {
    if (req.url === '/health') return next(); // Skip logging for health checks
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

// Health check endpoint for Render
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Core AI response generator (OpenRouter)
async function generateAIResponse(userMessage, history = [], productsContext = "", config = DEFAULT_CONFIG) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');

    // ── Sitemap-based category check ──────────────────────────────────────
    const smartCollection = catalogManager.getCollectionUrl(userMessage);
    if (smartCollection) {
        productsContext = `РЕКОМЕНДУЕМАЯ КАТЕГОРИЯ:
- [${smartCollection.title}](${smartCollection.url})

` + productsContext;
    }

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
5. ТЕРМОРАЗРЫВ: Бывает ТОЛЬКО у входных (сейф-дверей). В межкомнатных его нет. Если спрашивают — предлагай входные с терморазрывом.
6. Отвечай на русском языке
7. ПРИВЕТСТВИЕ: Здоровайся ТОЛЬКО в самом ПЕРВОМ сообщении диалога. Если история диалога уже содержит сообщения — НЕ здоровайся, просто продолжай разговор.
8. ПОСЛЕ ЛИДА (ВАЖНО): ТЫ МОЖЕШЬ ставить тег [[LEAD: ...]] и благодарить только тогда, когда у тебя есть ИМЯ и НОМЕР ТЕЛЕФОНА клиента. Если телефона нет — НЕ благодари за заявку, а вежливо попроси номер. Как только данные получены — поблагодари, скажи что менеджер свяжется, поставь тег и БОЛЬШЕ НЕ ЗАДАВАЙ ВОПРОСОВ. Разговор завершён.
9. БРЕНДЫ/ПРОИЗВОДИТЕЛИ: ЗАПРЕЩЕНО ПРИДУМЫВАТЬ названия брендов и фабрик. Но если клиент спрашивает «какие у вас производители/марки?» — используй тег [[NAV: brands]], который покажет реальные кнопки с брендами. Не перечисляй их текстом самостоятельно.
11. ХАРАКТЕРИСТИКИ И НАЗВАНИЯ МОДЕЛЕЙ: КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО:
    - Придумывать названия моделей (типа «Lidman Prestige 7», «Albero Modern 3» и т..д.) если они не есть в «Материалах для ответов».
    - Придумывать характеристики: покрытия, материалы, отделку, цвета (glossy, RAL, массив сосны и т..д.).
    - Придумывать URL с query-параметрами вида ?brand=, ?filter=, ?color= и пр.
    Если клиент спрашивает конкретные модели бренда, но в каталоге нет данных — отправь в коллекцию бренда (если есть в списке выше) или в общий каталог. Не перечисляй выдуманные модели — предложи посмотреть на сайте или приехать в салон.

10. ССЫЛКИ И КАТЕГОРИИ: СТРОЖАЙШИЙ ЗАПРЕТ на выдумывание или угадывание URL-адресов.
    «ЯДЕРНОЕ ПРАВИЛО»: Если ссылки нет в списке ниже или в блоке «Материалы для ответов» — ТЫ НЕ ИМЕЕШЬ ПРАВА ЕЁ ДАВАТЬ. Лучше не дать ссылку вообще, чем дать выдуманную.
    ЗАПРЕЩЕНО:
    - Изменять URL: добавлять ?brand=, ?price=, ?filter= и любые другие параметры.
    - Угадывать структуру: например, https://dveri-ekat.ru/collection/vhodnye-dveri-до-30000 — ТАКОЙ ССЫЛКИ НЕТ. Используй только те, что видишь ниже.
11. ЗАМЕР: Мы НЕ предлагаем БЕСПЛАТНЫЙ замер. Мы предлагаем «профессиональный замер» или просто «записаться на замер». Слово «бесплатный» под запретом.
12. ПРИОРИТЕТ: Если в «Материалах для ответов» указана «РЕКОМЕНДУЕМАЯ КАТЕГОРИЯ» — ОБЯЗАТЕЛЬНО используй её ссылку.

11. ЗАМЕР: Мы НЕ предлагаем БЕСПЛАТНЫЙ замер. Мы предлагаем «профессиональный замер» или просто «записаться на замер». Слово «бесплатный» под запретом.
12. ПРИОРИТЕТ: Если в «Материалах для ответов» указана «РЕКОМЕНДУЕМАЯ КАТЕГОРИЯ» — ОБЯЗАТЕЛЬНО используй её ссылку.
    б) РАЗДЕЛЫ КАТАЛОГА (только эти, не придумывать другие):
    - Весь каталог: https://dveri-ekat.ru/collection/all
    - Межкомнатные: https://dveri-ekat.ru/collection/mezhkomnatnye-dveri
    - Сейф-двери (входные): https://dveri-ekat.ru/collection/seyf-dveri
    - Входные с терморазрывом: https://dveri-ekat.ru/collection/seyf-dveri-s-termorazryvom
    - Скрытые двери: https://dveri-ekat.ru/collection/invisible
    - Двери эмаль: https://dveri-ekat.ru/collection/dveri-emal
    - Фурнитура: https://dveri-ekat.ru/collection/furnitura
    в) КОЛЛЕКЦИИ БРЕНДОВ (только эти, не придумывать другие):
    - WestStyle: https://dveri-ekat.ru/collection/weststyle
    - Universe: https://dveri-ekat.ru/collection/universe
    - Гармония: https://dveri-ekat.ru/collection/garmoniya
    - Synergy: https://dveri-ekat.ru/collection/sinerzhi-synergy
    - Albero: https://dveri-ekat.ru/collection/albero
    - ВФД (Владимирская фабрика дверей): https://dveri-ekat.ru/collection/vladimirskaya-fabrika-dverey
    - La Stella: https://dveri-ekat.ru/collection/la-stella-la-stella
    - Velldoris: https://dveri-ekat.ru/collection/velldoris-velldoris
    - Lidman: https://dveri-ekat.ru/collection/lidman
    - Аргус: https://dveri-ekat.ru/collection/argus
    г) СТРАНИЦЫ:
    - Замер: https://dveri-ekat.ru/page/zamer
    - Контакты: https://dveri-ekat.ru/page/contacts
    - Доставка: https://dveri-ekat.ru/page/delivery
    - Оплата: https://dveri-ekat.ru/page/payment
    - О нас: https://dveri-ekat.ru/page/about-us
    - Отзывы: https://dveri-ekat.ru/page/feedback
    - Скрытые двери (статья): https://dveri-ekat.ru/page/invisible-doors
    Если нужной ссылки нет — не давай ссылку. Направь клиента: https://dveri-ekat.ru/collection/all




НАВИГАЦИОННЫЕ ТЕГИ (добавляй в конец сообщения, пользователь видит только красивые кнопки):
- [[NAV: main_menu]]         — главное меню с категориями (при /start или «покажи всё»)
- [[NAV: interior]]          — межкомнатные двери (ТОЛЬКО для межкомнатных)
- [[NAV: interior_white]]    — белые/эмалевые межкомнатные двери
- [[NAV: entrance]]          — входные/сейф-двери (ТОЛЬКО для входных)
- [[NAV: entrance_thermal]]  — входные с терморазрывом
- [[NAV: hidden]]            — скрытые двери (invisible)
- [[NAV: brands]]            — список брендов/производителей (когда спрашивают «какие марки/фабрики»)
- [[NAV: funnel_start]]      — кнопки «В квартиру / В дом / В офис» (начало воронки)
- [[NAV: funnel_style]]      — кнопки стиля «Классика / Модерн / Минимализм»
- [[NAV: funnel_zamer]]      — кнопки «Записаться на замер / Перезвоните мне»
ВАЖНО: добавляй МАКСИМУМ ОДИН тег [[NAV: ...]] на сообщение. ЗАПРЕЩЕНО предлагать [[NAV: interior]] если пользователь ищет входные двери.

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
   - Предложи замер как логичный следующий шаг. Скажи: "Оставьте ваш номер телефона прямо здесь — менеджер сам свяжется и ответит на все вопросы".
   - ТЕЛЕФОН ОБЯЗАТЕЛЕН. Без телефона тег [[LEAD:]] НЕ ставится. Имя и адрес — опциональны.
   - Если клиент дал телефон — сразу ставь тег [[LEAD: {"name":"-","phone":"РЕАЛЬНЫЙ_НОМЕР_КЛИЕНТА","address":"-"}]] и благодари.
     (В поле "phone" подставляй только цифры номера из сообщения пользователя, не пиши слово "НОМЕР").
   - Если клиент дал имя И телефон — заполни оба поля в теге.
   - Если клиент отказывается давать телефон — не настаивай, просто скажи что можно позвонить самому: +7 (999) 340-62-15.

ОБЩИЕ ПРАВИЛА:
- НИКОГДА не заканчивай ответ точкой. Всегда задавай наводящий вопрос (кроме этапа благодарности за лид или когда клиент уходит).
- У нас самая большая выставка в Екатеринбурге (более 400 моделей) на Базовом пер., 47.`;

    console.log(`>>> [AI]: Generating response for message: "${userMessage.substring(0, 50)}..."`);
    console.log(`>>> [AI]: Context length: ${productsContext.length}, History depth: ${history.length}`);

    const MAX_RETRIES = 3;
    const MODELS = [
        'deepseek/deepseek-chat',           // ~$0.14/1M — умный, отличный русский (primary)
        'google/gemini-2.0-flash-001',      // ~$0.10/1M — быстрый и умный (retry)
        'meta-llama/llama-3.3-70b-instruct' // ~$0.12/1M — надёжный fallback
    ];

    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const model = MODELS[attempt - 1];
        try {
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://dveri-ekat.ru',
                    'X-Title': 'DveriBot'
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...history.map(m => ({
                            role: m.role === 'user' ? 'user' : 'assistant',
                            content: m.content || m.text || ''
                        })),
                        { role: 'user', content: userMessage }
                    ],
                    temperature: 0.6,
                    max_tokens: 500
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                const errMsg = errorData.error?.message || 'OpenRouter API error';
                console.warn(`>>> [AI]: Attempt ${attempt}/${MAX_RETRIES} failed: ${errMsg}`);
                lastError = new Error(errMsg);
                if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            const data = await response.json();
            let content = data.choices?.[0]?.message?.content || "";

            if (!content) {
                console.warn(`>>> [AI Warning]: Empty response on attempt ${attempt}`);
                lastError = new Error('Empty response');
                if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            content = content.replace(/[^\u0400-\u04FF\u0020-\u007E\u00A0-\u00FF\u2000-\u2BFF\uD83C-\uDBFF\uDC00-\uDFFF\s]/g, '');

            if (content.includes('[[LEAD:')) {
                console.log('>>> [AI Debug]: Lead tag detected in raw content');
            }

            if (attempt > 1) console.log(`>>> [AI]: Succeeded on attempt ${attempt}`);
            return content;

        } catch (e) {
            console.warn(`>>> [AI]: Attempt ${attempt}/${MAX_RETRIES} threw: ${e.message}`);
            lastError = e;
            if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 2000));
        }
    }

    throw lastError;
}



// Chat API handler (for web widget)
app.post('/api/chat', async (req, res) => {
    try {
        const { userMessage, history, productsContext, config } = req.body;
        let content = await generateAIResponse(userMessage, history, productsContext, config);

        // Check for lead tag
        const leadMatch = content.match(leadRegex);
        if (leadMatch) {
            try {
                const leadData = JSON.parse(leadMatch[1]);
                const phone = String(leadData.phone || '').trim();
                const hasPhone = phone && phone !== '-' && !phone.includes('НОМЕР') && !phone.includes('номер') && phone.length > 5;

                if (hasPhone) {
                    const adminMsg = `<b>🚀 НОВЫЙ ЛИД (Web)</b>\n\n👤 Имя: ${leadData.name}\n📞 Тел: ${leadData.phone}\n🏠 Адрес: ${leadData.address}`;
                    await notifyAdmin(adminMsg);
                    content = content.replace(leadRegex, '\n\n✅ Ваша заявка отправлена менеджеру! Мы скоро свяжемся с вами.').trim();
                } else {
                    // No phone — don't notify admin, just close conversation gracefully
                    content = content.replace(leadRegex, '').trim();
                }
            } catch (e) { console.error('Lead parse error:', e); }
        }

        res.status(200).json({ content });
    } catch (error) {
        console.error('Chat Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    // Запускаем тяжелый парсинг каталога только ПОСЛЕ того, 
    // как сервер поднялся и может отвечать на health-check от Render (за < 5 сек)
    catalogManager.init().catch(e => console.error("Catalog init error:", e));
});

// Telegram Bot Integration
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (botToken) {
    const bot = new Telegraf(botToken);
    const WEBHOOK_PATH = `/telegraf/${botToken}`;
    const URL = process.env.RENDER_EXTERNAL_URL || process.env.URL || '';

    if (URL) {
        app.use(bot.webhookCallback(WEBHOOK_PATH));
        console.log(`>>> [TELEGRAM]: Webhook enabled at ${URL}${WEBHOOK_PATH}`);
    }

    bot.start(async (ctx) => {
        const welcomeMessage = `Здравствуйте! 👋 Я виртуальный консультант магазина "Двери Екатеринбурга".\n\nЯ помогу вам выбрать межкомнатные или входные двери, фурнитуру и отвечу на вопросы об установке.\n\nВыберите интересующий раздел:`;
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🏠 Межкомнатные двери", callback_data: "cat_interior" }],
                    [{ text: "🛡 Сейф-двери (Входные)", callback_data: "cat_entrance" }],
                    [{ text: "🫥 Скрытые двери", callback_data: "cat_hidden" }],
                    [{ text: "📝 Записаться на замер", callback_data: "zamer_cmd" }]
                ]
            }
        };
        await ctx.reply(welcomeMessage, keyboard);
    });


    const processTelegramResponse = async (ctx, chatId, aiResponse, userMessage, extraOptions = {}) => {
        if (!aiResponse) return;

        // 1. Parse Navigation Tags
        let extra = { ...extraOptions };
        let hideButtons = false;

        // 2. Handle Lead Tag (Check first to decide on hiding buttons)
        const leadMatch = aiResponse.match(leadRegex);
        if (leadMatch) {
            try {
                const leadData = JSON.parse(leadMatch[1]);
                const sourceInfo = `TG (@${ctx.from.username || ctx.from.id})`;
                const phone = String(leadData.phone || '').trim();
                const hasPhone = phone && phone !== '-' && !phone.includes('НОМЕР') && !phone.includes('номер') && phone.length > 5;

                if (hasPhone) {
                    const interest = tgSessions[chatId]?.interest ? `\n🎯 Интерес: ${tgSessions[chatId].interest}` : '';
                    const adminMsg = `<b>🔥 НОВЫЙ ЛИД (${sourceInfo})</b>\n\n👤 Имя: ${leadData.name}\n📞 Тел: ${leadData.phone}\n🏠 Адрес: ${leadData.address}${interest}`;
                    await notifyAdmin(adminMsg);
                    aiResponse = aiResponse.replace(leadRegex, '\n\n✅ Ваша заявка передана менеджеру! Мы свяжемся с вами в ближайшее время.').trim();
                    hideButtons = true; // Success! Hide buttons
                    tgSessions[chatId].isLeadFlow = false; // Reset flow state
                    tgSessions[chatId].history = []; // Clear history only on success
                } else {
                    // Lead tag exists but phone is missing/invalid
                    aiResponse = 'Пожалуйста, уточните ваш номер телефона для связи 📞 (без него я не смогу передать заявку менеджеру).';
                    tgSessions[chatId].isLeadFlow = true; // Ensure we stay in flow
                }
            } catch (e) {
                console.error('TG Lead parse error:', e);
                aiResponse = aiResponse.replace(leadRegex, '').trim();
            }
        }

        const navMatch = aiResponse.match(navRegex);
        if (navMatch && !hideButtons) {
            const theme = navMatch[1].trim();
            aiResponse = aiResponse.replace(navRegex, '').trim();

            const navButtons = {
                "main_menu": [
                    [{ text: "🏠 Межкомнатные двери", url: "https://dveri-ekat.ru/collection/mezhkomnatnye-dveri" }],
                    [{ text: "🛡 Сейф-двери (Входные)", url: "https://dveri-ekat.ru/collection/seyf-dveri" }],
                    [{ text: "🫥 Скрытые двери", url: "https://dveri-ekat.ru/collection/invisible" }],
                    [{ text: "📝 Записаться на замер", callback_data: "zamer_cmd" }]
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
                    [{ text: "📝 Записаться на замер", callback_data: "zamer_cmd" }]
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
                    [{ text: "🏠 Межкомнатные двери", url: "https://dveri-ekat.ru/collection/mezhkomnatnye-dveri" }],
                    [{ text: "🛡 Входные сейф-двери", url: "https://dveri-ekat.ru/collection/seyf-dveri" }],
                    [{ text: "🚪 Весь каталог", url: "https://dveri-ekat.ru/collection/all" }]
                ],
                "funnel_style": [
                    [{ text: "🏛 Классика", url: "https://dveri-ekat.ru/collection/all?options[70183][]=493201" }],
                    [{ text: "✨ Модерн / Хай-тек", url: "https://dveri-ekat.ru/collection/all?options[70183][]=493202" }],
                    [{ text: "🫥 Минимализм (Скрытые)", url: "https://dveri-ekat.ru/collection/invisible" }]
                ],
                "funnel_zamer": [
                    [{ text: "📏 Записаться на замер", callback_data: "zamer_cmd" }],
                    [{ text: "📞 Перезвоните мне", callback_data: "leave_request" }]
                ],
                "entrance_thermal": [
                    [{ text: "🛡 Входные с терморазрывом", url: "https://dveri-ekat.ru/collection/seyf-dveri-s-termorazryvom" }],
                    [{ text: "🚪 Весь каталог сейф-дверей", url: "https://dveri-ekat.ru/collection/seyf-dveri" }]
                ]
            };

            const stickyButtons = [
                [{ text: "📝 Оставить заявку", callback_data: "leave_request" }],
                [{ text: "📞 Позвонить нам", url: "https://dveri-ekat.ru/page/contacts" }]
            ];

            if (navButtons[theme]) {
                extra.reply_markup = {
                    inline_keyboard: [...navButtons[theme], ...stickyButtons]
                };
            }
        }

        // 3. Clear ANY leaked system tags (extra safety)
        aiResponse = aiResponse.replace(/\[\[NAV:\s*(.+?)\]\]/g, '').trim();
        aiResponse = aiResponse.replace(leadRegex, '').trim();

        // 4. History and Limits
        if (tgSessions[chatId].history.length === 25) {
            aiResponse += "\n\n⚠️ Обратите внимание: через 5 ответов я начну забывать начало нашего разговора, так как моя память ограничена.";
        }
        if (userMessage) {
            tgSessions[chatId].history.push({ role: 'user', content: userMessage });
        }
        tgSessions[chatId].history.push({ role: 'assistant', content: aiResponse });
        if (tgSessions[chatId].history.length > 30) {
            tgSessions[chatId].history = tgSessions[chatId].history.slice(-30);
        }

        // 5. Send
        await ctx.reply(aiResponse, { parse_mode: 'Markdown', ...extra });
    };

    bot.on('text', async (ctx) => {
        const chatId = ctx.chat.id;
        const userMessage = ctx.message.text;

        if (!tgSessions[chatId]) tgSessions[chatId] = { history: [], interest: null, isLeadFlow: false };

        try {
            // Simple typing indicator
            await ctx.sendChatAction('typing');

            // Search catalog ONLY if not in lead flow
            let productsContext = "";
            if (!tgSessions[chatId].isLeadFlow) {
                const searchResults = catalogManager.search(userMessage);
                productsContext = searchResults.map(p => {
                    const brand = p.properties ? (p.properties['Изготовитель'] || p.properties['Производитель'] || '') : '';
                    const urlPart = p.url ? ` Ссылка: ${p.url}` : '';
                    return `- ${p.title}: ${p.price} руб.${brand ? ' Бренд: ' + brand : ''}${urlPart}`;
                }).join('\n');
            }

            // Generate AI response
            let aiResponse = await generateAIResponse(userMessage, tgSessions[chatId].history, productsContext);
            if (!aiResponse) {
                console.warn('>>> [AI Warning]: AI returned empty response for Telegram');
                return ctx.reply('Извините, не смог подобрать ответ. Попробуйте перефразировать вопрос. 🤔');
            }
            console.log(`AI Response for Telegram: "${aiResponse.substring(0, 100)}..."`);

            // Process response (tags, history, buttons, sending)
            await processTelegramResponse(ctx, chatId, aiResponse, userMessage);
        } catch (error) {
            console.error('>>> [TELEGRAM BOT ERROR]:', error.message);
            if (error.response) {
                console.error('Telegram API Error Data:', JSON.stringify(error.response));
            }
            ctx.reply('Извините, произошла ошибка при обработке вашего сообщения. Попробуйте другой вопрос. 🛠');
        }
    });

    if (URL) {
        bot.telegram.setWebhook(`${URL}${WEBHOOK_PATH}`)
            .then(() => console.log('>>> [TELEGRAM]: Webhook successfully set.'))
            .catch(err => console.error('>>> [TELEGRAM ERROR]: Failed to set webhook:', err.message));
    } else {
        bot.launch()
            .then(() => console.log('>>> [TELEGRAM]: Bot is successfully polling for updates (Local/Fallback).'))
            .catch(err => {
                console.error('>>> [TELEGRAM ERROR]: Failed to launch bot:', err.message);
            });
    }

    bot.command('status', (ctx) => ctx.reply('✅ Бот "Двери Екатеринбурга" работает и готов отвечать на вопросы!'));

    // Restore interactive menu and commands
    bot.telegram.setMyCommands([
        { command: 'start', description: '🏠 Начать диалог' },
        { command: 'zamer', description: '📏 Записаться на замер' },
        { command: 'contacts', description: '📞 Контакты и адрес' }
    ]).catch(err => console.error('Failed to set commands:', err));


    const zamerHandler = (ctx) => {
        ctx.reply('📏 Записаться на замер можно по ссылке ниже или просто оставьте ваши данные прямо здесь в чате.', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🌐 Записаться на сайте", url: "https://dveri-ekat.ru/page/zamer" }],
                    [{ text: "📝 Оставить заявку в чате", callback_data: "leave_request" }]
                ]
            }
        });
    };

    bot.command('zamer', zamerHandler);
    bot.action('zamer_cmd', zamerHandler);

    bot.command('contacts', (ctx) => {
        ctx.reply(`📍 Наш адрес: Екатеринбург, Базовый пер., 47 (у Леруа Мерлен)\n📞 Телефон: ${DEFAULT_CONFIG.operator.phone}\n✉️ Email: ${DEFAULT_CONFIG.operator.email}\n🕒 Часы работы: ${DEFAULT_CONFIG.operator.workHours}`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🗺 Открыть карту", url: "https://yandex.ru/maps/-/CCUfE0X0~A" }],
                    [{ text: "🌐 Наш сайт", url: "https://dveri-ekat.ru/" }]
                ]
            }
        });
    });

    bot.action('leave_request', (ctx) => {
        const chatId = ctx.chat.id;
        if (tgSessions[chatId]) tgSessions[chatId].isLeadFlow = true;
        ctx.reply('Отлично! Для оформления заявки, пожалуйста, напишите как вас зовут?');
    });

    // Category Interest Handlers
    const handleCategoryChoice = async (ctx, category, label) => {
        const chatId = ctx.chat.id;
        if (!tgSessions[chatId]) tgSessions[chatId] = { history: [], interest: null };

        // Store interest in session
        tgSessions[chatId].interest = label;

        // Push a hidden context for the AI
        tgSessions[chatId].history.push({ role: 'system', content: `КЛИЕНТ ВЫБРАЛ КАТЕГОРИЮ: ${label}. Поприветствуй его и уточни, какие именно двери его интересуют (стиль, цвет, бюджет). НЕ давай сразу прямые ссылки в первом сообщении.` });

        // Trigger AI response (label serves as "user input")
        const aiResponse = await generateAIResponse(label, tgSessions[chatId].history, "");
        await processTelegramResponse(ctx, chatId, aiResponse, null);
        await ctx.answerCbQuery();
    };

    bot.action('cat_interior', (ctx) => handleCategoryChoice(ctx, 'interior', 'Межкомнатные двери'));
    bot.action('cat_entrance', (ctx) => handleCategoryChoice(ctx, 'entrance', 'Входные сейф-двери'));
    bot.action('cat_hidden', (ctx) => handleCategoryChoice(ctx, 'hidden', 'Скрытые двери (Invisible)'));

    console.log('Telegram Bot logic initialized');

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
    console.warn('!!! [WARNING]: TELEGRAM_BOT_TOKEN not provided, skipping Telegram integration');
}
