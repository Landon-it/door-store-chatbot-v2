// ===== Configuration =====
const CONFIG = {
    // Store Information
    storeName: "Двери Екатеринбурга",

    // Bot Behavior
    behavior: {
        humorFrequency: 3, // 1 joke per 3-4 messages
        messageCounter: 0,
        typingDelay: {
            min: 800,
            max: 1500
        }
    },

    // Operator Settings
    operator: {
        phone: "+7 (999) 340-62-15",
        email: "office@dveri-ekat.ru",
        workHours: "Пн-Пт: 10:00-20:00, Сб-Вс: 10:00-19:00"
    },

    // Escalation Triggers
    escalationKeywords: [
        'заказ',
        'доставка',
        'жалоба',
        'возврат',
        'оператор',
        'человек',
        'менеджер',
        'специалист'
    ],

    // Prohibited Topics
    prohibitedTopics: [
        'политика',
        'война',
        'религия',
        'секс',
        'наркотики',
        'азартные игры',
        'лгбт',
        'нацизм',
        'фашизм',
        'терроризм',
        'экстремизм',
        'насилие',
        'жестокость',
        'самоубийство',
        'аборт',
        'эвтаназия',
        'оружие',
        'взрывчатка',
        'яды',
        'расизм',
        'ксенофобия',
        'гомофобия',
        'трансфобия',
        'сексизм',
        'мизогиния',
        'мизандрия',
        'антисемитизм',
        'исламофобия',
        'христианофобия',
        'буддофобия',
        'индуистфобия',
        'атеизмофобия',
        'агностицизмофобия',
        'агностицизм',
        'атеизм'
    ],

    // API Integration (Vercel Proxy)
    api: {
        enabled: true,
        // API Base URL for Render deployment
        baseUrl: 'https://door-store-chatbot.onrender.com',
        // API Key is now securely stored in Render Environment Variables (GROQ_API_KEY)
        // logic moved to server.js
        provider: 'groq'
    }

};
