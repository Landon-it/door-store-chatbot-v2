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
// GET request for initial configuration/checks AND OAuth callback
app.get('/api/bitrix/webhook', async (req, res) => {
    const { code } = req.query;

    res.type('html');
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Bitrix24 Bot Installation</title>
            <style>
                body { font-family: monospace; padding: 20px; background: #fff; color: #333; }
                .card { border: 1px solid #ccc; padding: 20px; margin: 20px auto; max-width: 600px; border-radius: 5px; }
                h1 { margin-top: 0; }
                .log { background: #f0f0f0; padding: 10px; border-radius: 4px; border: 1px solid #ddd; margin-top: 10px; white-space: pre-wrap; word-break: break-all; }
                .error { color: red; background: #ffe6e6; }
                .success { color: green; background: #e6ffe6; }
            </style>
            <script>
                // GLOBAL ERROR HANDLER
                window.onerror = function(msg, url, line, col, error) {
                    var extra = !col ? '' : '\\ncolumn: ' + col;
                    extra += !error ? '' : '\\nerror: ' + error;
                    var logEl = document.getElementById('error-log');
                    if (logEl) {
                        logEl.innerHTML += '<div class="log error">❌ JS ERROR: ' + msg + '\\nurl: ' + url + '\\nline: ' + line + extra + '</div>';
                    }
                    return false;
                };
            </script>
            <script src="https://api.bitrix24.com/api/v1/"></script>
        </head>
        <body>
            <div class="card">
                <h3>🛠 v3.0 DIAGNOSTIC MODE</h3>
                <p>Если вы видите этот текст — HTML загрузился.</p>
                
                <div id="status">⏳ Инициализация BX24...</div>
                
                <div id="error-log"></div>
                
                <button onclick="window.location.reload()" style="padding:10px; margin-top:20px; cursor:pointer;">Обновить страницу</button>
            </div>

            <script>
                // Helper logger
                function log(msg, type) {
                    var el = document.getElementById('status');
                    var color = type === 'error' ? 'red' : (type === 'success' ? 'green' : 'black');
                    el.innerHTML += '<div style="color:' + color + '; margin-top:5px;">' + msg + '</div>';
                }

                log('✅ Скрипт страницы запущен.', 'info');

                if (typeof BX24 === 'undefined') {
                    log('❌ CRITICAL: BX24 is undefined. Скрипт api.bitrix24.com не загрузился или заблокирован.', 'error');
                } else {
                    log('✅ BX24 object found.', 'success');
                    
                    try {
                        BX24.init(function() {
                            log('✅ BX24.init() callback fired!', 'success');
                            
                            // Construct webhook URL
                            var webhookUrl = '${req.protocol}://${req.get('host')}/api/bitrix/webhook';
                            log('🔗 Webhook URL: ' + webhookUrl, 'info');

                            var botParams = {
                                'CODE': 'door_store_bot',
                                'TYPE': 'B',
                                'EVENT_MESSAGE_ADD': webhookUrl,
                                'EVENT_WELCOME_MESSAGE': webhookUrl,
                                'PROPERTIES': {
                                    'NAME': 'Виртуальный консультант',
                                    'COLOR': 'GREEN',
                                    'EMAIL': 'office@dveri-ekat.ru',
                                    'WORK_POSITION': 'Бот-консультант'
                                }
                            };

                            log('🚀 Trying to register bot...', 'info');
                            
                            BX24.callMethod('imbot.register', botParams, function(res) {
                                if (res.error()) {
                                    // If error is "BOT_CODE_EXISTS", try update
                                    var err = res.error();
                                    log('⚠️ Registration result: ' + JSON.stringify(err), 'error');
                                    
                                    // Try to list bots to find ID
                                    BX24.callMethod('imbot.bot.list', {}, function(listRes) {
                                        if (listRes.error()) {
                                            log('❌ Failed to list bots: ' + listRes.error(), 'error');
                                        } else {
                                            var bots = listRes.data();
                                            var myBot = Object.values(bots).find(function(b){ return b.CODE === 'door_store_bot'; });
                                            if (myBot) {
                                                log('♻️ Bot found (ID=' + myBot.ID + '). Updating...', 'info');
                                                BX24.callMethod('imbot.update', { 'BOT_ID': myBot.ID, 'FIELDS': botParams }, function(updRes) {
                                                    if (updRes.error()) {
                                                        log('❌ Update failed: ' + updRes.error(), 'error');
                                                    } else {
                                                        log('✅ SUCCESS! Bot updated.', 'success');
                                                    }
                                                });
                                            } else {
                                                log('❌ Bot CODE exists but not found in list??', 'error');
                                            }
                                        }
                                    });

                                } else {
                                    log('✅ SUCCESS! Bot registered with ID: ' + res.data(), 'success');
                                }
                            });
                        });
                    } catch (e) {
                        log('❌ EXCEPTION in BX24.init: ' + e.message, 'error');
                    }
                }
            </script>
        </body>
        </html>
    `);
});

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
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
