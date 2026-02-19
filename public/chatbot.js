// ===== Chatbot Core Logic =====

class DoorStoreChatbot {
    constructor() {
        this.messageHistory = [];
        this.messageCounter = 0;

        // DOM Elements
        this.chatToggle = document.getElementById('chatToggle');
        this.chatContainer = document.getElementById('chatContainer');
        this.chatBadge = document.getElementById('chatBadge');
        this.messagesWrapper = document.getElementById('messagesWrapper');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        this.callOperatorButton = document.getElementById('callOperator');
        this.typingIndicator = document.getElementById('typingIndicator');
        this.charCount = document.getElementById('charCount');
        this.header = document.querySelector('.chat-header');

        // Chat state
        this.isOpen = false;

        this.init();
    }

    init() {
        // Toggle chat visibility
        this.chatToggle.addEventListener('click', () => this.toggleChat());

        // Add Menu button to header
        if (this.header) {
            const menuBtn = document.createElement('button');
            menuBtn.className = 'header-menu-btn';
            menuBtn.innerHTML = '📂 Меню';
            menuBtn.style.padding = '5px 10px';
            menuBtn.style.borderRadius = '15px';
            menuBtn.style.background = 'rgba(255,255,255,0.1)';
            menuBtn.style.border = '1px solid rgba(255,255,255,0.2)';
            menuBtn.style.color = 'white';
            menuBtn.style.fontSize = '12px';
            menuBtn.style.cursor = 'pointer';
            menuBtn.style.marginLeft = '10px';

            menuBtn.addEventListener('click', () => {
                this.addMessage('Главное меню магазина:', 'bot');
                this.renderNavButtons('main_menu', this.messagesWrapper.lastElementChild.querySelector('.message-content'));
            });
            this.header.appendChild(menuBtn);
        }

        // Event Listeners
        this.sendButton.addEventListener('click', () => this.handleSend());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSend();
            }
        });
        this.messageInput.addEventListener('input', () => this.handleInput());
        this.callOperatorButton.addEventListener('click', () => this.escalateToOperator());

        // Auto-resize textarea
        this.messageInput.addEventListener('input', () => this.autoResize());
    }


    handleInput() {
        const length = this.messageInput.value.length;
        this.charCount.textContent = length;

        if (length >= 500) {
            this.charCount.style.color = 'var(--accent)';
        } else {
            this.charCount.style.color = 'var(--text-tertiary)';
        }
    }

    autoResize() {
        this.messageInput.style.height = 'auto';
        this.messageInput.style.height = this.messageInput.scrollHeight + 'px';
    }

    toggleChat() {
        this.isOpen = !this.isOpen;

        if (this.isOpen) {
            this.chatContainer.classList.add('open');
            this.chatToggle.classList.add('active');
            this.chatToggle.setAttribute('aria-label', 'Закрыть чат');
            this.chatBadge.classList.remove('show');

            // Send welcome message on first open
            if (this.messageHistory.length === 0) {
                setTimeout(() => this.sendWelcomeMessage(), 500);
            }

            // Focus input
            setTimeout(() => this.messageInput.focus(), 300);
        } else {
            this.chatContainer.classList.remove('open');
            this.chatToggle.classList.remove('active');
            this.chatToggle.setAttribute('aria-label', 'Открыть чат');
        }
    }

    async handleSend() {
        const message = this.messageInput.value.trim();

        if (!message) return;

        // Add user message
        this.addMessage(message, 'user');
        this.messageInput.value = '';
        this.charCount.textContent = '0';
        this.messageInput.style.height = 'auto';

        // Check for prohibited topics
        if (this.containsProhibitedTopic(message)) {
            await this.showTypingIndicator();
            this.addMessage(
                'Извините, но я специализируюсь только на дверях и сопутствующих товарах. Могу рассказать о входных дверях, межкомнатных или фурнитуре. Чем могу быть полезен? 🚪',
                'bot'
            );
            return;
        }

        // Check for operator escalation
        if (this.shouldEscalateToOperator(message)) {
            await this.showTypingIndicator();
            this.escalateToOperator();
            return;
        }

        // Generate response
        await this.showTypingIndicator();

        let response;
        // Try Groq API first if enabled (Proxy handles the secret key)
        if (CONFIG.api.enabled) {
            // Search for relevant products in catalog
            const relevantProducts = typeof INSALES_BRIDGE !== 'undefined' ? await INSALES_BRIDGE.findProducts(message) : [];
            const productsContext = typeof INSALES_BRIDGE !== 'undefined' ? INSALES_BRIDGE.formatProductsForAI(relevantProducts, message) : null;

            response = await this.callGroqAPI(message, productsContext);
        }

        // Fallback to local logic if API failed or disabled
        if (!response) {
            response = this.generateResponse(message);
        }

        if (this.messageHistory.length === 25) {
            response += "\n\n⚠️ Обратите внимание: через 5 ответов я начну забывать начало нашего разговора, так как моя память ограничена.";
        }
        this.addMessage(response, 'bot');

        this.messageCounter++;

        // Add quick actions occasionally
        if (this.messageCounter % 2 === 0) {
            this.addQuickActions();
        }
    }

    sendWelcomeMessage() {
        const greeting = `Здравствуйте! 👋 Я виртуальный консультант магазина "${CONFIG.storeName}".\n\nДавайте подберем идеальные двери для Вашего дома. [[NAV: main_menu]]`;
        this.addMessage(greeting, 'bot');
    }

    addInitialQuickActions() {
        this.addQuickActions(['Входные двери', 'Межкомнатные двери', 'Фурнитура']);
    }

    async callGroqAPI(userMessage, productsContext = null) {
        try {
            const apiUrl = CONFIG.api.baseUrl ? `${CONFIG.api.baseUrl}/api/chat` : '/api/chat';
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userMessage,
                    history: this.messageHistory.slice(-30),
                    productsContext,
                    config: {
                        storeName: CONFIG.storeName,
                        operator: CONFIG.operator
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`Proxy error: ${response.status}`);
            }

            const data = await response.json();
            return data.content;
        } catch (error) {
            console.error('Chat API Error:', error);
            return null; // Fallback to local logic
        }
    }


    generateResponse(userMessage) {
        const messageLower = userMessage.toLowerCase();

        // Check FAQ first
        for (const [question, answer] of Object.entries(KNOWLEDGE_BASE.faq)) {
            if (messageLower.includes(question) || this.fuzzyMatch(messageLower, question)) {
                return this.maybeAddHumor(answer);
            }
        }

        // Detect intent
        if (this.matchesKeywords(messageLower, ['привет', 'здравствуй', 'добрый', 'hi', 'hello'])) {
            return this.getRandomElement(KNOWLEDGE_BASE.greetings);
        }

        if (this.matchesKeywords(messageLower, ['входная', 'входные', 'металлическая', 'железная', 'уличная', 'терморазрыв', 'терм', 'термо', 'термуха', 'для дома'])) {
            return this.getEntranceDoorInfo(messageLower);
        }

        if (this.matchesKeywords(messageLower, ['межкомнатная', 'межкомнатные', 'внутренняя', 'комнатная'])) {
            return this.getInteriorDoorInfo(messageLower);
        }

        if (this.matchesKeywords(messageLower, ['фурнитура', 'замок', 'замки', 'ручка', 'ручки', 'петли'])) {
            return this.getHardwareInfo(messageLower);
        }

        if (this.matchesKeywords(messageLower, ['установка', 'монтаж', 'установить', 'поставить'])) {
            return this.getInstallationInfo();
        }

        if (this.matchesKeywords(messageLower, ['уход', 'ухаживать', 'чистить', 'мыть', 'обслуживание'])) {
            return this.getCareInfo(messageLower);
        }

        if (this.matchesKeywords(messageLower, ['почта', 'email', 'емейл', 'написать'])) {
            return `📧 Наша электронная почта: <a href="mailto:office@dveri-ekat.ru">office@dveri-ekat.ru</a>\nПишите нам по любым вопросам!`;
        }

        if (this.matchesKeywords(messageLower, ['где', 'находитесь', 'адрес', 'салон', 'найти'])) {
            return `📍 <strong>Мы находимся по адресу:</strong>\nг. Екатеринбург, Базовый пер., 47, этаж 2\n\nКарта и подробности: <a href="https://dveri-ekat.ru/page/contacts" target="_blank">https://dveri-ekat.ru/page/contacts</a>`;
        }

        if (this.matchesKeywords(messageLower, ['цена', 'стоимость', 'бюджет', 'сколько стоит', 'стоят'])) {
            return this.getBudgetInfo(messageLower);
        }

        if (this.matchesKeywords(messageLower, ['гарантия', 'срок службы', 'сколько служат'])) {
            return this.getWarrantyInfo();
        }

        // Default response
        return this.getDefaultResponse();
    }

    getEntranceDoorInfo(message) {
        const doorInfo = KNOWLEDGE_BASE.doorTypes.entrance;
        let response = `🔒 <strong>Входные двери</strong>\n\n`;

        // Check for thermal break logic
        const thermalKeywords = ['терморазрыв', 'терм', 'термо', 'термуха', 'уличн', 'для дома'];
        if (thermalKeywords.some(k => message.includes(k))) {
            response += `<strong>С терморазрывом - отличный выбор для частного дома!</strong> Они не промерзают и сохраняют тепло.\n`;
            response += `Посмотрите все модели с терморазрывом здесь: https://dveri-ekat.ru/search?q=%D1%82%D0%B5%D1%80%D0%BC%D0%BE%D1%80%D0%B0%D0%B7%D1%80%D1%8B%D0%B2&lang=ru\n\n`;
            return this.maybeAddHumor(response);
        }

        // Check for specific material
        if (message.includes('металл') || message.includes('железн')) {
            const material = doorInfo.materials.metal;
            response += `${material.name}: ${material.description}\n`;
            response += `💰 Цены: ${material.priceRange}\n\n`;
            response += `<strong>Преимущества:</strong>\n${material.advantages.map(a => '✓ ' + a).join('\n')}\n\n`;
            response += `<strong>Популярные модели:</strong> ${material.popular.join(', ')}`;
        } else if (message.includes('дерев') || message.includes('деревян')) {
            const material = doorInfo.materials.wood;
            response += `${material.name}: ${material.description}\n`;
            response += `💰 Цены: ${material.priceRange}\n\n`;
            response += `<strong>Преимущества:</strong>\n${material.advantages.map(a => '✓ ' + a).join('\n')}`;
        } else {
            response += `У нас есть входные двери из разных материалов:\n\n`;
            for (const [key, material] of Object.entries(doorInfo.materials)) {
                response += `<strong>${material.name}</strong> - ${material.priceRange}\n`;
            }
            response += `\nКакой материал Вас интересует? Все модели в разделе: https://dveri-ekat.ru/collection/seyf-dveri`;
        }

        return this.maybeAddHumor(response);
    }

    getInteriorDoorInfo(message) {
        const doorInfo = KNOWLEDGE_BASE.doorTypes.interior;
        let response = `🚪 <strong>Межкомнатные двери</strong>\n\n`;

        if (message.includes('мдф')) {
            const material = doorInfo.materials.mdf;
            response += `${material.name}: ${material.description}\n`;
            response += `💰 Цены: ${material.priceRange}\n\n`;
            response += `<strong>Преимущества:</strong>\n${material.advantages.map(a => '✓ ' + a).join('\n')}`;
        } else if (message.includes('массив') || message.includes('дерев')) {
            const material = doorInfo.materials.wood;
            response += `${material.name}: ${material.description}\n`;
            response += `💰 Цены: ${material.priceRange}\n\n`;
            response += `<strong>Преимущества:</strong>\n${material.advantages.map(a => '✓ ' + a).join('\n')}`;
        } else if (message.includes('стекл')) {
            const material = doorInfo.materials.glass;
            response += `${material.name}: ${material.description}\n`;
            response += `💰 Цены: ${material.priceRange}\n\n`;
            response += `<strong>Преимущества:</strong>\n${material.advantages.map(a => '✓ ' + a).join('\n')}`;
        } else if (message.includes('стиль') || message.includes('дизайн')) {
            response += `<strong>Популярные стили:</strong>\n\n`;
            for (const [key, desc] of Object.entries(doorInfo.styles)) {
                response += `• <strong>${key.charAt(0).toUpperCase() + key.slice(1)}:</strong> ${desc}\n`;
            }
        } else {
            response += `Предлагаем межкомнатные двери:\n\n`;
            for (const [key, material] of Object.entries(doorInfo.materials)) {
                response += `<strong>${material.name}</strong> - ${material.priceRange}\n`;
            }
            response += `\nКакой материал предпочитаете? Посмотрите модели в разделе: https://dveri-ekat.ru/collection/mezhkomnatnye-dveri`;
        }

        return this.maybeAddHumor(response);
    }

    getHardwareInfo(message) {
        const hardware = KNOWLEDGE_BASE.hardware;
        let response = `🔧 <strong>Фурнитура для дверей</strong>\n\n`;

        if (message.includes('замок') || message.includes('замки')) {
            response += `${hardware.locks.name}:\n`;
            response += `Типы: ${hardware.locks.types.join(', ')}\n`;
            response += `💰 Цены: ${hardware.locks.priceRange}`;
        } else if (message.includes('ручк')) {
            response += `${hardware.handles.name}:\n`;
            response += `Типы: ${hardware.handles.types.join(', ')}\n`;
            response += `💰 Цены: ${hardware.handles.priceRange}`;
        } else if (message.includes('петл')) {
            response += `${hardware.hinges.name}:\n`;
            response += `Типы: ${hardware.hinges.types.join(', ')}\n`;
            response += `💰 Цены: ${hardware.hinges.priceRange}`;
        } else {
            response += `У нас есть вся необходимая фурнитура:\n\n`;
            response += `• <strong>Замки</strong> (https://dveri-ekat.ru/collection/catalog-zamkov) - ${hardware.locks.priceRange}\n`;
            response += `• <strong>Ручки</strong> (https://dveri-ekat.ru/collection/catalog-ruchek) - ${hardware.handles.priceRange}\n`;
            response += `• <strong>Петли</strong> - ${hardware.hinges.priceRange}\n`;
            response += `• <strong>Прочее:</strong> ${hardware.other.items.join(', ')}`;
        }

        return this.maybeAddHumor(response);
    }

    getInstallationInfo() {
        const info = KNOWLEDGE_BASE.installation;
        let response = `🔨 <strong>Установка дверей</strong>\n\n`;
        response += `⏱️ Время установки: ${info.duration}\n`;
        response += `💰 ${info.price}\n`;
        response += `🛡️ ${info.warranty}\n\n`;
        response += `<strong>Что входит в установку:</strong>\n`;
        response += info.includedServices.map(s => '✓ ' + s).join('\n');
        response += `\n\nПримеры выполненных работ можно посмотреть здесь: https://dveri-ekat.ru/blogs/completework`;
        response += `\n\nДля точного расчёта и записи на замер - передаю Вас оператору!`;

        return response;
    }

    getCareInfo(message) {
        const care = KNOWLEDGE_BASE.care;
        let response = `🧹 <strong>Уход за дверями</strong>\n\n`;

        if (message.includes('дерев')) {
            response += `<strong>Деревянные двери:</strong>\n${care.wood}`;
        } else if (message.includes('металл')) {
            response += `<strong>Металлические двери:</strong>\n${care.metal}`;
        } else if (message.includes('стекл')) {
            response += `<strong>Стеклянные двери:</strong>\n${care.glass}`;
        } else if (message.includes('мдф')) {
            response += `<strong>МДФ двери:</strong>\n${care.mdf}`;
        } else {
            response += `Расскажите, какие у Вас двери (материал), и я дам конкретные рекомендации по уходу!`;
        }

        return this.maybeAddHumor(response);
    }

    getBudgetInfo(message) {
        const budgets = KNOWLEDGE_BASE.budgetRanges;
        let response = `💰 <strong>Подбор по бюджету</strong>\n\n`;

        // Try to extract budget from message
        const numbers = message.match(/\d+/g);
        if (numbers && numbers.length > 0) {
            const budget = parseInt(numbers[0]);

            if (budget < 10000) {
                const range = budgets.economy;
                response += `При бюджете ${budget}₽ рекомендую:\n\n`;
                response += `<strong>${range.name}</strong> (${range.range})\n${range.recommendation}`;
            } else if (budget < 30000) {
                const range = budgets.medium;
                response += `При бюджете ${budget}₽ рекомендую:\n\n`;
                response += `<strong>${range.name}</strong> (${range.range})\n${range.recommendation}`;
            } else {
                const range = budgets.premium;
                response += `При бюджете ${budget}₽ могу предложить:\n\n`;
                response += `<strong>${range.name}</strong> (${range.range})\n${range.recommendation}`;
            }
        } else {
            response += `Назовите Ваш бюджет, и я подберу оптимальные варианты!\n\n`;
            for (const [key, range] of Object.entries(budgets)) {
                response += `<strong>${range.name}</strong> (${range.range}):\n${range.recommendation}\n\n`;
            }
        }

        return this.maybeAddHumor(response);
    }

    getWarrantyInfo() {
        let response = `🛡️ <strong>Гарантия и срок службы</strong>\n\n`;
        response += KNOWLEDGE_BASE.faq['сколько служат двери'];
        response += `\n\n`;
        response += KNOWLEDGE_BASE.faq['какая гарантия'];

        return this.maybeAddHumor(response);
    }

    getDefaultResponse() {
        const responses = [
            'Интересный вопрос! Но чтобы дать точный ответ, мне лучше передать Вас нашему оператору. Также Вы можете посмотреть все товары в каталоге: https://dveri-ekat.ru/collection/all 😊',
            'Хм, это немного выходит за рамки моей специализации. Давайте я соединю Вас с оператором, а пока можете посмотреть наши новинки: https://dveri-ekat.ru/collection/all',
            'Отличный вопрос! Чтобы не давать неточную информацию, лучше уточню у оператора. Или попробуйте найти конкретную модель через поиск: https://dveri-ekat.ru/search',
            'Могу ли я помочь Вам с выбором конкретного типа дверей? Весь ассортимент доступен здесь: https://dveri-ekat.ru/collection/all'
        ];

        return this.getRandomElement(responses);
    }

    maybeAddHumor(response) {
        // Add humor every 3-4 messages
        if (this.messageCounter > 0 && this.messageCounter % CONFIG.behavior.humorFrequency === 0) {
            const joke = this.getRandomElement(KNOWLEDGE_BASE.jokes);
            return response + `\n\n${joke}`;
        }
        return response;
    }

    containsProhibitedTopic(message) {
        const messageLower = message.toLowerCase();
        return CONFIG.prohibitedTopics.some(topic =>
            messageLower.includes(topic)
        );
    }

    shouldEscalateToOperator(message) {
        const messageLower = message.toLowerCase();
        return CONFIG.escalationKeywords.some(keyword =>
            messageLower.includes(keyword)
        );
    }

    escalateToOperator() {
        let response = `👨‍💼 <strong>Передаю Вас оператору</strong>\n\n`;
        response += `Наш специалист поможет Вам лучше!\n\n`;
        response += `📞 Телефон: <a href="tel:${CONFIG.operator.phone.replace(/[\s\(\)-]/g, '')}" class="contact-link">${CONFIG.operator.phone}</a>\n`;
        response += `📧 Email: <a href="mailto:${CONFIG.operator.email}" class="contact-link">${CONFIG.operator.email}</a>\n`;
        response += `🕐 Часы работы: ${CONFIG.operator.workHours}\n\n`;
        response += `Или оставьте свой номер, и мы перезвоним в ближайшее время! ☎️`;

        this.addMessage(response, 'bot');
    }

    addMessage(text, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = type === 'bot'
            ? `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 5C13.66 5 15 6.34 15 8C15 9.66 13.66 11 12 11C10.34 11 9 9.66 9 8C9 6.34 10.34 5 12 5ZM12 19.2C9.5 19.2 7.29 17.92 6 15.98C6.03 13.99 10 12.9 12 12.9C13.99 12.9 17.97 13.99 18 15.98C16.71 17.92 14.5 19.2 12 19.2Z" fill="currentColor"/>
               </svg>`
            : `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z" fill="currentColor"/>
               </svg>`;

        const content = document.createElement('div');
        content.className = 'message-content';

        const messageText = document.createElement('div');
        messageText.className = 'message-text';
        messageText.innerHTML = this.formatMessage(text);

        const time = document.createElement('span');
        time.className = 'message-time';
        time.textContent = this.getCurrentTime();

        content.appendChild(messageText);
        content.appendChild(time);

        messageDiv.appendChild(avatar);
        messageDiv.appendChild(content);

        this.messagesWrapper.appendChild(messageDiv);
        this.scrollToBottom();

        // Check for navigation tags if it's a bot message
        if (type === 'bot') {
            const navData = this.parseNavTags(text);
            if (navData.theme) {
                // Remove tag from displayed text
                messageText.innerHTML = this.formatMessage(navData.text);
                this.renderNavButtons(navData.theme, content);
            }
        }

        // Store message in history (using terminology expected by the server)
        this.messageHistory.push({
            role: type === 'bot' ? 'assistant' : 'user',
            content: text,
            timestamp: new Date()
        });
    }

    addQuickActions(actions = null) {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'quick-actions';

        const actionList = actions || KNOWLEDGE_BASE.quickActions;

        actionList.forEach(action => {
            const button = document.createElement('button');
            button.className = 'quick-action-btn';
            button.textContent = action;
            button.addEventListener('click', () => {
                this.messageInput.value = action;
                this.handleSend();
            });
            actionsDiv.appendChild(button);
        });

        // Add to last bot message
        const lastMessage = this.messagesWrapper.querySelector('.message.bot:last-child .message-content');
        if (lastMessage) {
            lastMessage.appendChild(actionsDiv);
        }
    }

    async showTypingIndicator() {
        this.typingIndicator.classList.add('active');
        this.scrollToBottom();

        const delay = Math.random() *
            (CONFIG.behavior.typingDelay.max - CONFIG.behavior.typingDelay.min) +
            CONFIG.behavior.typingDelay.min;

        await new Promise(resolve => setTimeout(resolve, delay));

        this.typingIndicator.classList.remove('active');
    }

    formatMessage(text) {
        // Convert URLs to <a> tags (excluding those already in tags or tel/mailto)
        const urlRegex = /(?<!href="|">)(https?:\/\/[^\s<]+)/g;
        text = text.replace(urlRegex, (url) => {
            return `<a href="${url}" target="_blank" class="content-link">${url}</a>`;
        });

        // Convert phone numbers to tel: links
        const phone = CONFIG.operator.phone;
        const cleanPhone = phone.replace(/[\s\(\)-]/g, '');

        // 1. Match the specific configured phone number exactly
        // Lookbehind prevents matching if already inside an <a> tag (preceded by href=", ">", or :)
        const escapedPhone = phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const specificPhoneRegex = new RegExp(`(?<!href="|">|:|=")${escapedPhone}`, 'g');
        text = text.replace(specificPhoneRegex, `<a href="tel:${cleanPhone}" class="contact-link">${phone}</a>`);

        // 2. Match general Russian phone formats as a fallback
        // Lookbehind prevents matching inside existing tags or attributes
        const generalPhoneRegex = /(?<!href="|">|:|=|"|\d)(\+7|8)[\s(]?\d{3}[)\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g;
        text = text.replace(generalPhoneRegex, (match) => {
            const clean = match.replace(/[\s\(\)-]/g, '');
            // Convert 8... to +7... for the link
            const telLink = clean.startsWith('8') ? '+7' + clean.slice(1) : clean;
            return `<a href="tel:${telLink}" class="contact-link">${match}</a>`;
        });

        // Convert newlines to <br>
        text = text.replace(/\n/g, '<br>');

        return text;
    }

    getCurrentTime() {
        const now = new Date();
        return now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }

    scrollToBottom() {
        this.messagesWrapper.parentElement.scrollTop = this.messagesWrapper.parentElement.scrollHeight;
    }

    matchesKeywords(text, keywords) {
        return keywords.some(keyword => text.includes(keyword));
    }

    fuzzyMatch(text, pattern) {
        // Simple fuzzy matching
        const words = pattern.split(' ');
        return words.filter(word => text.includes(word)).length >= words.length * 0.6;
    }

    parseNavTags(text) {
        const navRegex = /\[\[NAV:\s*(.+?)\]\]/;
        const match = text.match(navRegex);
        if (match) {
            return {
                text: text.replace(navRegex, '').trim(),
                theme: match[1].trim()
            };
        }
        return { text, theme: null };
    }

    renderNavButtons(theme, container) {
        if (!KNOWLEDGE_BASE.navigationButtons || !KNOWLEDGE_BASE.navigationButtons[theme]) return;

        const navDiv = document.createElement('div');
        navDiv.className = 'nav-buttons';

        const buttons = KNOWLEDGE_BASE.navigationButtons[theme];
        buttons.forEach(btn => {
            const a = document.createElement('a');
            if (btn.url.startsWith('#')) {
                a.href = 'javascript:void(0)';
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.messageInput.value = (btn.url === '#leave-request') ? 'Я хочу оставить заявку' : btn.label;
                    this.handleSend();
                });
            } else {
                a.href = btn.url;
                a.target = '_blank';
            }
            a.className = 'nav-btn';
            a.textContent = btn.label;
            navDiv.appendChild(a);
        });

        container.appendChild(navDiv);

        // Add sticky CTA buttons if not already in a lead-specific theme
        if (theme !== 'funnel_zamer') {
            const stickyDiv = document.createElement('div');
            stickyDiv.className = 'nav-buttons sticky-ctas';
            stickyDiv.style.marginTop = '8px';
            stickyDiv.style.borderTop = '1px dashed rgba(0,0,0,0.1)';
            stickyDiv.style.paddingTop = '8px';

            const ctas = [
                { label: "📝 Оставить заявку", url: "#leave-request" },
                { label: "📞 Позвонить", url: "tel:+79993406215" }
            ];

            ctas.forEach(cta => {
                const a = document.createElement('a');
                a.className = 'nav-btn secondary';
                a.textContent = cta.label;
                if (cta.url.startsWith('#')) {
                    a.href = 'javascript:void(0)';
                    a.addEventListener('click', () => {
                        this.messageInput.value = 'Я хочу оставить заявку';
                        this.handleSend();
                    });
                } else {
                    a.href = cta.url;
                }
                stickyDiv.appendChild(a);
            });
            container.appendChild(stickyDiv);
        }

        this.scrollToBottom();
    }

    getRandomElement(array) {
        return array[Math.floor(Math.random() * array.length)];
    }
}

// Initialize chatbot (check if DOM is already ready)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new DoorStoreChatbot());
} else {
    new DoorStoreChatbot();
}
