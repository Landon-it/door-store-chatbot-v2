// ===== InSales Data Bridge (Server-side Version) =====
// Теперь поиск товаров происходит на сервере Render, что быстрее и надежнее

class InSalesBridge {
    constructor() {
        this.apiBaseUrl = typeof CONFIG !== 'undefined' ? CONFIG.api.baseUrl : '';
    }

    /**
     * Инициализация (теперь просто проверка связи)
     */
    async init() {
        console.log('InSales Bridge: Работает через серверный поиск');
    }

    /**
     * Поиск подходящих товаров через API сервера
     */
    async findProducts(query, limit = 5) {
        if (!query) return [];

        try {
            console.log(`InSales Bridge: Запрос поиска на сервер: "${query}"`);
            const response = await fetch(`${this.apiBaseUrl}/api/search?q=${encodeURIComponent(query)}`);

            if (!response.ok) throw new Error('Search API error');

            const results = await response.json();
            return results.slice(0, limit);
        } catch (error) {
            console.error('InSales Bridge: Ошибка при поиске на сервере:', error);
            return [];
        }
    }

    /**
     * Форматирование найденных товаров для контекста ИИ
     */
    formatProductsForAI(products) {
        if (!products || products.length === 0) {
            return "К сожалению, в нашем расширенном каталоге по вашему конкретному запросу ничего не найдено. Предложите клиенту уточнить параметры или связаться с оператором.";
        }

        return "Найденные позиции в каталоге:\n" + products.map(p => {
            const price = p.price ? `${p.price} руб.` : 'по запросу';
            const url = p.url ? (p.url.startsWith('http') ? p.url : `https://dveri-ekat.ru${p.url}`) : '#';
            const category = p.category ? `[${p.category}] ` : '';
            return `- ${category}${p.title} (${price}). Ссылка: ${url}`;
        }).join('\n');
    }
}

// Global instance
const INSALES_BRIDGE = new InSalesBridge();
INSALES_BRIDGE.init();
