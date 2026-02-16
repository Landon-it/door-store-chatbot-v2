import express from 'express';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import BitrixBot from './bitrix-bot.js';
import { catalogManager } from './catalog-manager.js';
import cron from 'node-cron';

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

const bitrixBot = new BitrixBot(
    process.env.BITRIX24_DOMAIN,
    process.env.BITRIX24_CLIENT_ID,
    process.env.BITRIX24_CLIENT_SECRET
);

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

// VITAL: Parse URL-encoded bodies (sent by Bitrix24 form POSTs)
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
10. КРИТИЧНО: Давай КОРОТКИЕ и ЛАКОНИЧНЫЕ ответы! Максимум 3-5 предложений.
11. ПРОАКТИВНОСТЬ В ССЫЛКАХ: 
    - НЕ предлагай "посетить наш сайт" (клиент уже на нем). Просто давай ссылку на конкретный раздел каталога, который поможет клиенту.
    - Ссылка на Межкомнатные двери: https://dveri-ekat.ru/collection/mezhkomnatnye-dveri
    - Ссылка на Входные (Сейф) двери: https://dveri-ekat.ru/collection/seyf-dveri
    - Ссылка на весь каталог: https://dveri-ekat.ru/collection/all
    - Если клиент ищет что-то конкретное (бренд, материал, тип), ОБЯЗАТЕЛЬНО давай ссылку на поиск по сайту: https://dveri-ekat.ru/search?q=[ключевое_слово_из_запроса]
12. ВЕЖЛИВОСТЬ: Всегда обращайся к клиенту на "Вы" (с большой буквы). Используй "Вы", "Вас", "Вам", "Ваш", "Вами" ТОЛЬКО с заглавной буквы. Это очень важно для имиджа магазина.
13. ПРОИЗВОДИТЕЛИ И БРЕНДЫ: Если клиент спрашивает о производителях, фабриках или брендах, ты должен изучить список товаров (Context) ниже. Извлекай название бренда из параметра "Бренд:", "Изготовитель" или "Производитель". Перечисляй ТОЛЬКО те бренды, которые реально присутствуют в списке товаров для данной категории. Если список пуст, предложи воспользоваться поиском.
14. СТРОГО ПО КАТАЛОГУ: Если в предоставленном списке товаров (Context) нет подходящих позиций, не выдумывай названия. Честно скажи, что таких моделей сейчас нет, и предложи похожие из списка или поиск по всему сайту.
15. СИНОНИМЫ И РАЗДЕЛЫ: 
    - "ВФД" — это Владимирская фабрика дверей или Владимирская фабрика или Владимирский завод дверей.
    - "Скрытые двери" — это модели "Invisible". Ссылка: https://dveri-ekat.ru/search?q=invisible&lang=ru
    - "Доставка" — раздел: https://dveri-ekat.ru/page/delivery
    - "Оплата" — раздел: https://dveri-ekat.ru/page/payment
    - "Установка" — ссылайся на раздел "Наши работы": https://dveri-ekat.ru/blogs/completework
    - "Фурнитура" — это разделы "Замки" (https://dveri-ekat.ru/collection/catalog-zamkov) и "Ручки" (https://dveri-ekat.ru/collection/catalog-ruchek). Обязательно предлагай эти ссылки при запросе фурнитуры.
    - "Сейф-двери" или "сейфы" — это всегда "Входные двери".
    - "Терморазрыв" (а также "терм", "термо", "термуха", "уличная", "для дома") — это ВСЕГДА входные двери. Если клиент использует эти слова, давай ссылку: https://dveri-ekat.ru/search?q=%D1%82%D0%B5%D1%80%D0%BC%D0%BE%D1%80%D0%B0%D0%B7%D1%80%D1%8B%D0%B2&lang=ru
    - "Почта" или "email" — адрес: office@dveri-ekat.ru (делай ссылку кликабельной: <a href="mailto:office@dveri-ekat.ru">office@dveri-ekat.ru</a>)
    - "Где вы", "Адрес", "Куда ехать", "Контакты" — адрес: Екатеринбург, Базовый пер., 47, этаж 2. Ссылка: https://dveri-ekat.ru/page/contacts`;

    if (productsContext) {
        systemPrompt += `\n\nВ нашем каталоге найдены реальные товары (используй ТОЛЬКО их для конкретных рекомендаций по моделям и брендам):\n${productsContext}`;
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
// GET request for Initial Install AND OAuth processing
app.get('/api/bitrix/webhook', async (req, res) => {
    const { code } = req.query;
    const currentDomain = req.get('x-forwarded-host') || req.get('host');
    const protocol = req.get('x-forwarded-proto') || req.protocol;
    const secureProtocol = (protocol === 'https' || currentDomain.includes('localhost')) ? protocol : 'https';
    const redirectUri = `${secureProtocol}://${currentDomain}/api/bitrix/webhook`;

    // 1. If we have 'code', it's the OAuth callback -> Exchange for token and Register
    if (code) {
        try {
            console.log(`Received OAuth code: ${code}. Swapping for token...`);

            // NOTE: For 'Box' (self-hosted) bitrix96.ru, the token URL is on the domain itself.
            const tokenUrl = `https://${process.env.BITRIX24_DOMAIN}/oauth/token/?grant_type=authorization_code&client_id=${process.env.BITRIX24_CLIENT_ID}&client_secret=${process.env.BITRIX24_CLIENT_SECRET}&code=${code}&redirect_uri=${encodeURIComponent(redirectUri)}`;
            console.log('Fetching token from:', tokenUrl.replace(process.env.BITRIX24_CLIENT_SECRET, '***'));

            const tokenResponse = await fetch(tokenUrl);
            const tokenData = await tokenResponse.json();
            console.log('Token Data received:', tokenData);

            if (tokenData.error) {
                console.error('Token Exchange Error:', tokenData);
                return res.send(`
                    <div style="font-family: sans-serif; padding: 30px; border: 1px solid #ffc9c9; background: #fff5f5; color: #c92a2a;">
                        <h2>❌ Ошибка обмена токена</h2>
                        <pre>${JSON.stringify(tokenData, null, 2)}</pre>
                        <p>Пожалуйста, проверьте <b>BITRIX24_CLIENT_SECRET</b> в настройках Render.</p>
                    </div>
                `);
            }

            const botParams = {
                'CODE': 'door_store_bot',
                'TYPE': 'H',
                'EVENT_HANDLER': redirectUri,
                'OPENLINE': 'Y',
                'PROPERTIES': {
                    'NAME': 'Виртуальный консультант',
                    'COLOR': 'GREEN',
                    'EMAIL': 'bot@dveri-ekat.ru',
                    'PERSONAL_BIRTHDAY': '2024-02-15',
                    'PERSONAL_WWW': 'https://dveri-ekat.ru',
                    'PERSONAL_GENDER': 'M',
                    'OPENLINE': 'Y',
                }
            };

            console.log('Attempting bot registration with token...');
            const portal = tokenData.domain || process.env.BITRIX24_DOMAIN;
            const regResult = await bitrixBot.callMethod('imbot.register', botParams, { access_token: tokenData.access_token, domain: portal });
            console.log('Registration Raw Result:', JSON.stringify(regResult));

            let botId = null;

            if (regResult.error) {
                if (regResult.error === 'BOT_ALREADY_REGISTERED' || regResult.error === 'CODE_ALREADY_EXIST') {
                    console.log('Bot already exists. Finding and updating...');
                    const listResult = await bitrixBot.getBotList({ access_token: tokenData.access_token, domain: portal });
                    if (listResult.result) {
                        const existingBot = Object.values(listResult.result).find(b => b.CODE === 'door_store_bot');
                        if (existingBot) {
                            const updResult = await bitrixBot.updateBot(existingBot.ID, botParams, { access_token: tokenData.access_token, domain: portal });
                            botId = existingBot.ID;
                        } else {
                            return res.send(`<h1>Error</h1><p>Bot exists but not found in list.</p>`);
                        }
                    } else {
                        return res.send(`<h1>Error</h1><p>Could not fetch bot list.</p><pre>${JSON.stringify(listResult)}</pre>`);
                    }
                } else {
                    console.error('Registration failed:', regResult.error);
                    return res.send(`
                        <div style="font-family: sans-serif; padding: 40px; border: 2px solid #e03131; background: #fff5f5; border-radius: 12px; color: #c92a2a; max-width: 800px; margin: 20px auto;">
                            <h2 style="margin-top: 0;">❌ Ошибка регистрации в Битрикс24</h2>
                            <p><b>Код ошибки:</b> <code>${regResult.error}</code></p>
                            <p><b>Описание:</b> ${regResult.error_description || 'Нет описания'}</p>
                            <hr style="border: 0; border-top: 1px solid #ffc9c9; margin: 20px 0;">
                            <p><b>Что это значит:</b></p>
                            <ul style="line-height: 1.6;">
                                ${regResult.error === 'INSUFFICIENT_SCOPE' ? '<li><b>Права не получены:</b> Битрикс проигнорировал запрос на права. Проверьте настройки приложения.</li>' : ''}
                                ${regResult.error === 'METHOD_NOT_FOUND' ? '<li><b>Модуль imbot не найден:</b> На портале не установлен модуль Чat-боты.</li>' : ''}
                            </ul>
                            <pre style="background: #eee; padding: 10px; font-size: 11px;">${JSON.stringify(regResult, null, 2)}</pre>
                        </div>
                    `);
                }
            } else {
                botId = regResult.result;
            }

            // Success Page
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <script src="//api.bitrix24.com/api/v1/"></script>
                    <script> function goToOpenLines() { BX24.openPath('/contact_center/openlines'); } </script>
                </head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px; background-color: #d4edda; color: #155724;">
                    <h1>✅ Бот успешно настроен!</h1>
                    <p>ID Бота: ${botId}</p>
                    <button onclick="goToOpenLines()" style="padding: 10px 20px; font-size: 16px; margin-top: 20px; cursor: pointer;">⚙️ Открыть настройки Линий</button>
                </body>
                </html>
            `);

        } catch (error) {
            console.error('Server Logic Error:', error);
            return res.send(`<h1>Internal Server Error</h1><pre>${error.message}</pre>`);
        }
    }

    // 2. If NO 'code' -> Redirect to OAuth
    const portalDomain = req.query.DOMAIN || process.env.BITRIX24_DOMAIN;
    const clientId = process.env.BITRIX24_CLIENT_ID;
    const scopes = 'im imbot imopenlines rest placement crm';
    const oauthUrl = `https://${portalDomain}/oauth/authorize/?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;

    console.log('Redirecting to OAuth:', oauthUrl);
    return res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Redirecting...</title></head>
        <body>
            <p>🔄 Перенаправление на авторизацию Bitrix24...</p>
            <script> window.location.href = "${oauthUrl}"; </script>
        </body>
        </html>
    `);
});

app.post('/api/bitrix/webhook', async (req, res) => {
    console.log(`[HTTP ${req.method}] ${req.url} | Body keys: ${Object.keys(req.body)} | Query: ${JSON.stringify(req.query)}`);

    // 1. Bitrix24 sends POST application/x-www-form-urlencoded
    // We need 'express.urlencoded' middleware to parse it (AUTH_ID, etc)
    let { event, AUTH_ID, DOMAIN } = req.body;

    // Fallback: Bitrix often sends DOMAIN in Query String during App Load
    if (!DOMAIN && req.query.DOMAIN) {
        DOMAIN = req.query.DOMAIN;
    }

    console.log('POST /api/bitrix/webhook keys:', Object.keys(req.body), 'Query keys:', Object.keys(req.query));
    console.log('Extracted DOMAIN:', DOMAIN);

    // Case A: Webhook Event (Async processing)
    if (event) {
        console.log(`>>> [DEBUG] RECEIVED BITRIX24 EVENT: ${event}`);
        console.log('>>> [DEBUG] DATA:', JSON.stringify(req.body.data));
        console.log('>>> [DEBUG] AUTH:', JSON.stringify(req.body.auth));

        res.status(200).send(''); // Acknowledge immediately

        const data = req.body.data;
        const auth = req.body.auth;

        if (event === 'ONIMBOTMESSAGEADD') {
            const userMessage = data.PARAMS.MESSAGE;
            const chatId = data.PARAMS.DIALOG_ID;
            const botId = data.BOT_ID || (data.PARAMS && data.PARAMS.BOT_ID);

            console.log(`>>> [DEBUG] Processing message: "${userMessage}" from chat ${chatId} (Bot ID: ${botId})`);

            try {
                // Determine portal domain from auth or data
                const portal = auth.domain || data.DOMAIN || process.env.BITRIX24_DOMAIN;

                // Search catalog for context
                console.log('>>> [DEBUG] Searching catalog...');
                const searchResults = catalogManager.search(userMessage);
                console.log(`>>> [DEBUG] Found ${searchResults.length} products.`);

                const productsContext = searchResults.map(p => {
                    const brand = p.properties ? (p.properties['Изготовитель'] || p.properties['Производитель'] || '') : '';
                    return `- ${p.title}: ${p.price} руб.${brand ? ' Бренд: ' + brand : ''}`;
                }).join('\n');

                // Generate AI response
                console.log('>>> [DEBUG] Generating AI response...');
                let aiResponse = await generateAIResponse(userMessage, [], productsContext);
                console.log(`>>> [DEBUG] AI Response ready: "${aiResponse.substring(0, 50)}..."`);

                // Remove HTML tags for Bitrix24 if any
                aiResponse = aiResponse.replace(/<[^>]*>?/gm, '');

                // Send back to Bitrix24
                console.log('>>> [DEBUG] Sending message back to Bitrix...');
                const response = await bitrixBot.sendMessage(botId, chatId, aiResponse, {
                    access_token: auth.access_token,
                    domain: portal
                });
                console.log('>>> [DEBUG] Bitrix response:', JSON.stringify(response));
            } catch (error) {
                console.error('>>> [CRITICAL] Bitrix24 Error:', error);
            }
        }
        return;
    }

    const currentDomain = req.get('x-forwarded-host') || req.get('host');
    const protocol = req.get('x-forwarded-proto') || req.protocol;
    const secureProtocol = (protocol === 'https' || currentDomain.includes('localhost')) ? protocol : 'https';
    const redirectUri = `${secureProtocol}://${currentDomain}/api/bitrix/webhook`;
    const scopes = 'im imbot imopenlines rest placement crm';

    // Use the DOMAIN from Bitrix request if available, otherwise fallback to env
    const portalDomain = DOMAIN || process.env.BITRIX24_DOMAIN;
    const clientId = process.env.BITRIX24_CLIENT_ID;

    // VALIDATION: Prevent redirecting to "https://undefined/..."
    if (!portalDomain || !clientId) {
        console.error('ERROR: Missing BITRIX24_DOMAIN or BITRIX24_CLIENT_ID');
        return res.status(500).send(`
            <div style="font-family: sans-serif; padding: 30px; border: 1px solid #ffc9c9; background: #fff5f5; border-radius: 8px; color: #c92a2a;">
                <h3>❌ Ошибка конфигурации (Environment Missing)</h3>
                <p>На сервере Render не заданы переменные окружения:</p>
                <ul>
                    ${!portalDomain ? '<li>BITRIX24_DOMAIN (адрес вашего портала)</li>' : ''}
                    ${!clientId ? '<li>BITRIX24_CLIENT_ID (ID из настроек приложения)</li>' : ''}
                </ul>
                <p>Пожалуйста, добавьте их в <b>Render Dashboard -> Environment</b> и дождитесь перезапуска.</p>
                <hr>
                <p style="font-size: 12px;">DOMAIN from request: ${DOMAIN || 'not provided'}</p>
            </div>
        `);
    }

    const oauthUrl = `https://${portalDomain}/oauth/authorize/?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;

    // Case B: Application Load (POST from Bitrix Interface)
    if (AUTH_ID && !req.body.action) {
        console.log('App loaded via POST. Verifying scopes...');
        try {
            const appInfo = await bitrixBot.appInfo({ access_token: AUTH_ID, domain: DOMAIN });
            const hasScope = appInfo.result && appInfo.result.SCOPE && appInfo.result.SCOPE.includes('imopenlines');

            if (!hasScope) {
                console.log('CRITICAL: Scopes missing in current token. Redirecting top window to OAuth...');
                return res.send(`
                    <!DOCTYPE html>
                    <html>
                    <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                        <div style="background: #fff5f5; border: 1px solid #ffc9c9; padding: 30px; border-radius: 12px; color: #c92a2a; display: inline-block;">
                            <h2>🔓 Требуется подтверждение прав</h2>
                            <p>Для работы бота необходимо подтвердить доступ к чатам и линиям.</p>
                            <p>Нажмите кнопку ниже для авторизации.</p>
                            <a href="${oauthUrl}" target="_top" style="background: #e03131; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block; margin-top: 15px;">
                                ✅ РАЗРЕШИТЬ ДОСТУП
                            </a>
                            <p style="font-size: 12px; margin-top: 20px; color: #868e96;">Это обновит ваш токен доступа в Bitrix24 Box.</p>
                        </div>
                        <script>
                            // Auto-redirect top window if possible
                            setTimeout(() => {
                                // Bitrix IFrames usually allow top-level navigation if the user is in the portal
                                // window.top.location.href = "${oauthUrl}";
                            }, 3000);
                        </script>
                    </body>
                    </html>
                `);
            }
        } catch (err) {
            console.error('Scope Check Error:', err);
        }

        console.log('Showing advanced Management UI.');
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; text-align: center; padding: 40px; background: #f0f4f8; color: #334e68; }
                    .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); display: inline-block; max-width: 600px; width: 100%; border: 1px solid #e2e8f0; text-align: left; }
                    h1 { color: #102a43; margin-top: 0; font-size: 24px; text-align: center; }
                    p { line-height: 1.6; color: #486581; margin-bottom: 25px; }
                    .btn { background: #0091ea; color: white; border: none; padding: 12px 25px; border-radius: 8px; font-size: 15px; cursor: pointer; transition: all 0.2s; font-weight: 600; margin-bottom: 10px; width: 100%; display: block; text-align: center; text-decoration: none; }
                    .btn:hover { background: #007bc7; transform: translateY(-1px); }
                    .btn-secondary { background: #627d98; }
                    .btn-danger { background: #cc3300; }
                    .info { margin-top: 25px; padding: 15px; background: #eef2f7; border-radius: 8px; font-size: 13px; color: #334e68; }
                    .section { margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px; }
                    label { font-weight: bold; display: block; margin-bottom: 10px; color: #102a43; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>🤖 Управление ботом</h1>
                    <p>Используйте эти инструменты для настройки и диагностики "Виртуального консультанта".</p>
                    
                    <div class="section">
                        <label>1. Основные действия:</label>
                        <form method="POST">
                            ${Object.keys(req.body).map(key => `<input type="hidden" name="${key}" value="${req.body[key]}">`).join('\n')}
                            <input type="hidden" name="action" value="install">
                            <button type="submit" class="btn">🚀 Установить / Обновить (Стандарт)</button>
                        </form>

                        <form method="POST">
                            ${Object.keys(req.body).map(key => `<input type="hidden" name="${key}" value="${req.body[key]}">`).join('\n')}
                            <input type="hidden" name="action" value="force_reinstall">
                            <button type="submit" class="btn btn-secondary">♻️ Полная переустановка (Сброс + Регистрация)</button>
                        </form>
                    </div>

                    <div class="section">
                        <label>2. Соединение (OAuth):</label>
                        <a href="${oauthUrl}" target="_top" class="btn btn-secondary">🔑 Принудительно обновить права (OAuth)</a>
                    </div>

                    <div class="section">
                        <label>3. Инструменты отладки:</label>
                        <form method="POST">
                            ${Object.keys(req.body).map(key => `<input type="hidden" name="${key}" value="${req.body[key]}">`).join('\n')}
                            <input type="hidden" name="action" value="diagnostics">
                            <button type="submit" class="btn btn-secondary">🔍 Посмотреть список ботов и права доступа</button>
                        </form>
                    </div>

                    <div class="info">
                        <strong>Подсказка:</strong> В коробочных версиях Битрикс24 переход по кнопке "Обновить права" часто является единственным способом заставить Битрикс "увидеть" новые галочки в Scope.
                    </div>
                </div>
            </body>
            </html>
        `);
    }

    if (AUTH_ID && req.body.action) {
        const action = req.body.action;

        const botParams = {
            'CODE': 'door_store_bot',
            'TYPE': 'H', // Use 'H' (Humanized) for better Open Lines compatibility
            'EVENT_HANDLER': redirectUri,
            'OPENLINE': 'Y',
            'PROPERTIES': {
                'NAME': 'Виртуальный консультант',
                'COLOR': 'GREEN',
                'EMAIL': 'bot@dveri-ekat.ru',
                'PERSONAL_BIRTHDAY': '2024-02-15',
                'PERSONAL_WWW': 'https://dveri-ekat.ru',
                'PERSONAL_GENDER': 'M',
                'OPENLINE': 'Y',
            }
        };

        try {
            // ACTION: Diagnostics
            if (action === 'diagnostics') {
                const list = await bitrixBot.getBotList({ access_token: AUTH_ID, domain: DOMAIN });
                const appInfo = await bitrixBot.appInfo({ access_token: AUTH_ID, domain: DOMAIN });

                let myBotDetails = "Bot record found, but details method failed.";
                if (list.result) {
                    const myBot = Object.values(list.result).find(b => b.CODE === 'door_store_bot');
                    if (myBot) {
                        try {
                            const detailRes = await bitrixBot.callMethod('imbot.bot.get', { BOT_ID: myBot.ID }, { access_token: AUTH_ID, domain: DOMAIN });
                            myBotDetails = JSON.stringify(detailRes, null, 2);
                        } catch (e) {
                            myBotDetails = `Error fetching details: ${e.message}`;
                        }
                    } else {
                        myBotDetails = "Bot 'door_store_bot' not found in the list.";
                    }
                }

                const hasScope = appInfo.result && appInfo.result.SCOPE && appInfo.result.SCOPE.includes('imopenlines');
                const isInstalled = appInfo.result && appInfo.result.INSTALLED;
                const rawScope = appInfo.result && appInfo.result.SCOPE ? appInfo.result.SCOPE : 'пусто';
                const isNarrowedScope = rawScope === 'app';

                let criticalWarning = '';
                if (isNarrowedScope) {
                    criticalWarning = `
                        <div style="background: #fff9db; border: 2px solid #f08c00; padding: 20px; border-radius: 12px; margin-bottom: 25px; color: #855d00;">
                            <h3 style="margin-top: 0;">⚠️ Ограниченные права (Scope narrowing)</h3>
                            <p>Битрикс выдал токен только с правом <b>"app"</b>. Это означает, что он игнорирует запрос на <i>im, imbot, imopenlines</i>.</p>
                            <p style="font-weight: bold;">КАК ИСПРАВИТЬ:</p>
                            <ol>
                                <li>Зайдите в настройки Локального приложения в Битриксе.</li>
                                <li>Убедитесь, что галочки <b>"Чат и уведомления"</b> и <b>"Чат-боты"</b> не просто стоят, а <b>СОХРАНЕНЫ</b> (нажмите кнопку "Сохранить" в самом низу страницы).</li>
                                <li>После сохранения обязательно нажмите кнопку <b>"🔑 Принудительно обновить права (OAuth)"</b> на этой странице.</li>
                            </ol>
                        </div>
                    `;
                } else if (!hasScope || !isInstalled) {
                    criticalWarning = `
                        <div style="background: #fff0f0; border: 2px solid #e03131; padding: 20px; border-radius: 12px; margin-bottom: 25px; color: #c92a2a;">
                            <h3 style="margin-top: 0;">❌ Проблема синхронизации прав (Bitrix Box Issue)</h3>
                            <p>Битрикс сообщает, что у приложения <b>нет прав (SCOPE: ${appInfo.result && appInfo.result.SCOPE ? appInfo.result.SCOPE : 'пусто'})</b>, хотя в настройках галочки стоят.</p>
                            <p style="font-weight: bold;">ВАШЕ ДЕЙСТВИЕ В БИТРИКСЕ:</p>
                            <ol>
                                <li>Вернитесь в настройки Локального приложения в Битриксе.</li>
                                <li>Нажмите на голубую кнопку <b>ПЕРЕУСТАНОВИТЬ</b> (рядом с кнопкой "Перейти к приложению").</li>
                                <li>Это ОБЯЗАТЕЛЬНО для обновления токенов в коробочной версии.</li>
                            </ol>
                        </div>
                    `;
                }

                return res.send(`
                    <!DOCTYPE html>
                    <html>
                    <body style="font-family: 'Segoe UI', sans-serif; padding: 20px; color: #333; line-height: 1.5; background: #f0f2f5;">
                        <div style="max-width: 900px; margin: 0 auto; background: white; padding: 30px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
                            <h2 style="color: #102a43; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px; margin-top: 0;">🔍 Диагностика подключения</h2>
                            
                            <div style="margin-bottom: 25px; font-size: 14px; color: #627d98; background: #f8fafc; padding: 10px; border-radius: 8px;">
                                <strong>Домен:</strong> ${DOMAIN} | 
                                <strong>Обработчик (HANDLER):</strong> <code style="color: #d63384;">${redirectUri}</code>
                            </div>

                            ${criticalWarning}

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                                <div>
                                    <h4 style="margin-bottom: 10px;">Статус в Б24:</h4>
                                    <div style="padding: 15px; border-radius: 8px; background: ${isInstalled ? '#ebfbee' : '#fff9db'}; color: ${isInstalled ? '#2b8a3e' : '#f08c00'}; font-weight: bold; border: 1px solid currentColor;">
                                        ${isInstalled ? '✅ Установлено' : '⏳ Требует переустановки'}
                                    </div>
                                </div>
                                <div>
                                    <h4 style="margin-bottom: 10px;">Права доступа (Scope):</h4>
                                    <div style="padding: 15px; border-radius: 8px; background: ${hasScope ? '#ebfbee' : '#fff5f5'}; color: ${hasScope ? '#2b8a3e' : '#e03131'}; font-weight: bold; border: 1px solid currentColor; word-break: break-all;">
                                        ${hasScope ? appInfo.result.SCOPE : '❌ НЕТ ПРАВ'}
                                    </div>
                                </div>
                            </div>

                            <h3 style="margin-top: 30px; font-size: 16px;">1. Ответ app.info:</h3>
                            <pre style="background: #1a1a1a; color: #00ff00; padding: 15px; border-radius: 8px; overflow: auto; font-size: 12px; max-height: 200px;">${JSON.stringify(appInfo, null, 2)}</pre>
                            
                            <h3 style="margin-top: 20px; font-size: 16px;">2. Детали нашего бота (imbot.bot.get):</h3>
                            <pre style="background: #f8f9fa; padding: 15px; border-radius: 8px; overflow: auto; font-size: 12px; border: 1px solid #dee2e6;">${myBotDetails}</pre>

                            <h3 style="margin-top: 20px; font-size: 16px;">3. Все боты на портале:</h3>
                            <pre style="background: #f8f9fa; padding: 15px; border-radius: 8px; max-height: 200px; overflow: auto; font-size: 12px; border: 1px solid #dee2e6;">${JSON.stringify(list, null, 2)}</pre>
                            
                            <div style="margin-top: 30px; text-align: center;">
                                <a href="javascript:history.back()" style="background: #0091ea; color: white; padding: 12px 30px; border-radius: 8px; font-weight: bold; text-decoration: none; display: inline-block;">⬅️ Вернуться в меню управления</a>
                            </div>
                        </div>
                    </body>
                    </html>
                `);
            }

            // ACTION: Force Reinstall
            if (action === 'force_reinstall') {
                console.log('Action: force_reinstall. Finding existing bot to remove...');
                const list = await bitrixBot.getBotList({ access_token: AUTH_ID, domain: DOMAIN });
                if (list.result) {
                    const existing = Object.values(list.result).find(b => b.CODE === 'door_store_bot');
                    if (existing) {
                        console.log(`Unregistering bot ID=${existing.ID}...`);
                        await bitrixBot.unregisterBot(existing.ID, { access_token: AUTH_ID, domain: DOMAIN });
                    }
                }
                // Continue to install fresh...
            }

            // ACTION: Install / Re-install part
            let botId = null;
            const regResult = await bitrixBot.callMethod('imbot.register', botParams, { access_token: AUTH_ID, domain: DOMAIN });

            if (regResult.error) {
                // If it exists and we are NOT in force_reinstall, try to update
                const listResult = await bitrixBot.getBotList({ access_token: AUTH_ID, domain: DOMAIN });
                if (listResult.result) {
                    const existingBot = Object.values(listResult.result).find(b => b.CODE === 'door_store_bot');
                    if (existingBot) {
                        const updResult = await bitrixBot.updateBot(existingBot.ID, botParams, { access_token: AUTH_ID, domain: DOMAIN });
                        if (updResult.error) return res.send(`<h1>Update Error</h1><pre>${JSON.stringify(updResult, null, 2)}</pre>`);
                        botId = existingBot.ID;
                    } else {
                        return res.send(`<h1>Error</h1><pre>${JSON.stringify(regResult, null, 2)}</pre>`);
                    }
                }
            } else {
                botId = regResult.result;
            }

            return res.send(`
                <!DOCTYPE html>
                <html>
                <head><script src="//api.bitrix24.com/api/v1/"></script><script>function goToOpenLines() { BX24.openPath('/contact_center/openlines'); }</script></head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #e8f5e9; color: #2e7d32;">
                    <div style="background: white; padding: 40px; border-radius: 16px; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                        <h1>✅ Успешно!</h1>
                        <p>Бот <b>Виртуальный консультант</b> зарегистрирован (ID: ${botId}).</p>
                        <button style="background: #4caf50; color: white; border: none; padding: 12px 30px; border-radius: 6px; cursor: pointer; margin-top: 25px; font-weight: bold;" onclick="goToOpenLines()">⚙️ Перейти к настройкам</button>
                    </div>
                </body>
                </html>
            `);
        } catch (error) {
            return res.send(`<h1>System Error</h1><pre>${error.message}</pre>`);
        }
    }

    // Default fallback
    res.status(200).send('Bitrix24 Bot Server. No event or auth data received.');
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
