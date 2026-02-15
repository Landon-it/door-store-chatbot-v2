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
    const currentDomain = req.get('host');
    const protocol = req.protocol;
    // For production behind proxy/Vercel/Render, ensure protocol is https
    const secureProtocol = (protocol === 'https' || currentDomain.includes('localhost')) ? protocol : 'https';

    // This URL must match what you send as redirect_uri
    const redirectUri = `${secureProtocol}://${currentDomain}/api/bitrix/webhook`;

    // 1. If we have 'code', it's the OAuth callback -> Exchange for token and Register
    if (code) {
        try {
            console.log(`Received OAuth code: ${code}. Swapping for token...`);

            // NOTE: For 'Box' (self-hosted) bitrix96.ru, the token URL is on the domain itself.
            const tokenUrl = `https://${process.env.BITRIX24_DOMAIN}/oauth/token/?grant_type=authorization_code&client_id=${process.env.BITRIX24_CLIENT_ID}&client_secret=${process.env.BITRIX24_CLIENT_SECRET}&code=${code}&redirect_uri=${encodeURIComponent(redirectUri)}`;

            const tokenResponse = await fetch(tokenUrl);
            const tokenData = await tokenResponse.json();

            if (tokenData.error) {
                console.error('Token Exchange Error:', tokenData);
                return res.send(`<h1>OAuth Error</h1><pre>${JSON.stringify(tokenData, null, 2)}</pre>`);
            }

            console.log('Token acquired. Registering bot...');

            // Register OR Update Bot
            let botId = null;
            const botParams = {
                'CODE': 'door_store_bot',
                'TYPE': 'B',
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

            const regResult = await bitrixBot.callMethod('imbot.register', botParams, { access_token: tokenData.access_token, domain: process.env.BITRIX24_DOMAIN });

            if (regResult.error) {
                console.warn('Registration failed (probably exists). Error:', regResult.error);
                // Try to find and update
                const listResult = await bitrixBot.getBotList({ access_token: tokenData.access_token, domain: process.env.BITRIX24_DOMAIN });
                if (listResult.result) {
                    const existingBot = Object.values(listResult.result).find(b => b.CODE === 'door_store_bot');
                    if (existingBot) {
                        console.log(`Found existing bot ID=${existingBot.ID}. Updating...`);
                        const updResult = await bitrixBot.updateBot(existingBot.ID, botParams, { access_token: tokenData.access_token, domain: process.env.BITRIX24_DOMAIN });
                        if (updResult.error) {
                            console.error('Update Error:', updResult);
                            return res.send(`<h1>Update Failed</h1><pre>${JSON.stringify(updResult, null, 2)}</pre>`);
                        }
                        botId = existingBot.ID;
                        console.log('Bot updated successfully.');
                    } else {
                        return res.send(`<h1>Registration Failed</h1><p>Bot CODE exists but not found in list?</p><pre>${JSON.stringify(regResult, null, 2)}</pre>`);
                    }
                } else {
                    return res.send(`<h1>List Failed</h1><pre>${JSON.stringify(listResult, null, 2)}</pre>`);
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
                    <script>
                        function goToOpenLines() {
                            BX24.openPath('/contact_center/openlines');
                        }
                    </script>
                </head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px; background-color: #d4edda; color: #155724;">
                    <h1>✅ Бот успешно настроен! (Server-Side)</h1>
                    <p>ID Бота: ${botId}</p>
                    <p>Теперь он точно должен появиться в "Открытых линиях".</p>
                    <button onclick="goToOpenLines()" style="padding: 10px 20px; font-size: 16px; margin-top: 20px; cursor: pointer;">
                        ⚙️ Перейти к настройкам Открытых линий
                    </button>
                    <p style="margin-top: 30px; font-size: 14px; color: #555;">
                        <strong>Если кнопка не работает:</strong><br>
                        1. В левом меню выберите "Контакт-центр".<br>
                        2. Нажмите "Открытые линии".<br>
                        3. Зайдите в настройки линии -> вкладка "Чат-боты".<br>
                        4. Выберите "Виртуальный консультант" и сохраните.
                    </p>
                </body>
                </html>
            `);

        } catch (error) {
            console.error('Server Logic Error:', error);
            return res.send(`<h1>Internal Server Error</h1><pre>${error.message}</pre>`);
        }
    }

    // 2. If NO 'code', assume it's the first visit (Open Application) -> Redirect to OAuth
    // This forces the user to authorize/install the app, returning to this specific URL with a code.
    const oauthUrl = `https://${process.env.BITRIX24_DOMAIN}/oauth/authorize/?client_id=${process.env.BITRIX24_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}`;

    console.log('Redirecting to OAuth:', oauthUrl);

    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Redirecting...</title></head>
        <body>
            <p>🔄 Перенаправление на авторизацию Bitrix24...</p>
            <script>
                window.location.href = "${oauthUrl}";
            </script>
        </body>
        </html>
    `);
});

app.post('/api/bitrix/webhook', async (req, res) => {
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
        console.log('Received Webhook Event:', event);
        res.status(200).send(''); // Acknowledge immediately

        const data = req.body.data;
        const auth = req.body.auth;

        if (event === 'ONIMBOTMESSAGEADD') {
            const userMessage = data.PARAMS.MESSAGE;
            const chatId = data.PARAMS.DIALOG_ID;
            const botId = data.BOT_ID;

            try {
                // Search catalog for context
                const searchResults = catalogManager.search(userMessage);
                const productsContext = searchResults.map(p => {
                    const brand = p.properties ? (p.properties['Изготовитель'] || p.properties['Производитель'] || '') : '';
                    return `- ${p.title}: ${p.price} руб.${brand ? ' Бренд: ' + brand : ''}`;
                }).join('\n');

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
        return;
    }

    // Case B: Application Load (POST from Bitrix Interface)
    if (AUTH_ID && !req.body.action) {
        console.log('App loaded via POST. Showing advanced Management UI.');

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
                        <label>2. Инструменты отладки:</label>
                        <form method="POST">
                            ${Object.keys(req.body).map(key => `<input type="hidden" name="${key}" value="${req.body[key]}">`).join('\n')}
                            <input type="hidden" name="action" value="diagnostics">
                            <button type="submit" class="btn btn-secondary">🔍 Посмотреть список ботов и права доступа</button>
                        </form>
                    </div>

                    <div class="info">
                        <strong>Подсказка:</strong> В коробочных версиях Битрикс24 иногда требуется "Полная переустановка", чтобы изменения в настройках чат-ботов вступили в силу.
                    </div>
                </div>
            </body>
            </html>
        `);
    }

    // Advanced Actions Handler
    if (AUTH_ID && req.body.action) {
        const action = req.body.action;
        const currentDomain = req.get('host');
        const protocol = req.protocol;
        const secureProtocol = (protocol === 'https' || currentDomain.includes('localhost')) ? protocol : 'https';
        const redirectUri = `${secureProtocol}://${currentDomain}/api/bitrix/webhook`;

        const botParams = {
            'CODE': 'door_store_bot',
            'TYPE': 'B',
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

                return res.send(`
                    <!DOCTYPE html>
                    <html>
                    <body style="font-family: sans-serif; padding: 20px; color: #333;">
                        <h2>🔍 Результаты диагностики</h2>
                        <div><strong>Текущий домен:</strong> ${DOMAIN}</div>
                        <div><strong>Права доступа (Scope):</strong> ${appInfo.result ? appInfo.result.SCOPE : 'N/A'}</div>
                        <h3>Список ботов на портале:</h3>
                        <pre style="background: #f4f4f4; padding: 15px; border-radius: 8px; max-height: 400px; overflow: auto;">${JSON.stringify(list, null, 2)}</pre>
                        <a href="javascript:history.back()" style="display: inline-block; margin-top: 20px; color: #0091ea;">⬅️ Вернуться назад</a>
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
