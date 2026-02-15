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

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Search API error: ${response.status} ${errorText}`);
            }

            const results = await response.json();
            return results.slice(0, limit);
        } catch (error) {
            console.error('InSales Bridge: Ошибка при поиске на сервере:', error.message);
            return [];
        }
    }

    formatProductsForAI(products, query = "") {
        if (!products || products.length === 0) {
            // System instruction for AI when nothing is found
            return `[СИСТЕМНОЕ СООБЩЕНИЕ]: По прямому запросу "${query}" товаров в каталоге не найдено.
            НЕ ГОВОРИ "ничего не найдено".
            Вместо этого:
            1. Определи интент пользователя (Входные или Межкомнатные двери?).
            2. Предложи одну из главных категорий:
               - Входные: https://dveri-ekat.ru/collection/seyf-dveri
               - Межкомнатные: https://dveri-ekat.ru/collection/mezhkomnatnye-dveri
            3. ИЛИ, если запрос специфичный (например "белые"), дай ссылку на поиск с этим параметром: https://dveri-ekat.ru/search?q=${encodeURIComponent(query)}&lang=ru
            4. Если запрос - бред, просто предложи помощь с выбором.`;
        }

        return "Найденные позиции в каталоге:\n" + products.map(p => {
            const price = p.price ? `${p.price} руб.` : 'по запросу';
            const url = p.url ? (p.url.startsWith('http') ? p.url : `https://dveri-ekat.ru${p.url}`) : '#';
            const category = p.category ? `[${p.category}] ` : '';

            // Extract brand from properties
            const brand = p.properties ? (p.properties['Изготовитель'] || p.properties['Производитель'] || '') : '';
            const brandStr = brand ? `Бренд: ${brand}. ` : '';

            return `- ${category}${p.title} (${price}). ${brandStr}Ссылка: ${url}`;
        }).join('\n');
    }
}

// Global instance
const INSALES_BRIDGE = new InSalesBridge();
INSALES_BRIDGE.init();
