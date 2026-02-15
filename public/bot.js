(function () {
    // Dynamically detect base URL from the script tag itself or default to official domain
    const scriptTag = document.currentScript;
    const BASE_URL = scriptTag ? new URL(scriptTag.src).origin : 'https://door-store-chatbot.onrender.com';

    const SCRIPTS = [
        'config.js',
        'knowledge-base.js',
        'insales-bridge.js',
        'chatbot.js'
    ];

    // 1. Ingest Styles with cache busting
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${BASE_URL}/styles.css?v=${Date.now()}`;
    document.head.appendChild(link);

    // 2. Inject HTML Structure
    const botHtml = `
    <div class="chat-widget">
        <button class="chat-toggle" id="chatToggle" aria-label="Открыть чат">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 2H4C2.9 2 2.01 2.9 2.01 4L2 22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2ZM18 14H6V12H18V14ZM18 11H6V9H18V11ZM18 8H6V6H18V8Z" fill="currentColor" />
            </svg>
            <span class="chat-badge" id="chatBadge">1</span>
        </button>

        <div class="chat-container" id="chatContainer">
            <div class="chat-header">
                <div class="header-content">
                    <div class="bot-avatar">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 5C13.66 5 15 6.34 15 8C15 9.66 13.66 11 12 11C10.34 11 9 9.66 9 8C9 6.34 10.34 5 12 5ZM12 19.2C9.5 19.2 7.29 17.92 6 15.98C6.03 13.99 10 12.9 12 12.9C13.99 12.9 17.97 13.99 18 15.98C16.71 17.92 14.5 19.2 12 19.2Z" fill="currentColor" />
                        </svg>
                    </div>
                    <div class="header-info">
                        <h1 class="bot-name">Виртуальный Консультант</h1>
                        <p class="bot-status"><span class="status-indicator"></span>В сети</p>
                    </div>
                </div>
                <button class="operator-button" id="callOperator" title="Вызвать оператора">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M20 15.5C18.75 15.5 17.55 15.3 16.43 14.93C16.08 14.82 15.69 14.9 15.41 15.17L13.21 17.37C10.38 15.93 8.06 13.62 6.62 10.79L8.82 8.58C9.1 8.31 9.18 7.92 9.07 7.57C8.7 6.45 8.5 5.25 8.5 4C8.5 3.45 8.05 3 7.5 3H4C3.45 3 3 3.45 3 4C3 13.39 10.61 21 20 21C20.55 21 21 20.55 21 20V16.5C21 15.95 20.55 15.5 20 15.5Z" fill="currentColor" />
                    </svg>
                </button>
            </div>

            <div class="messages-container" id="messagesContainer">
                <div class="messages-wrapper" id="messagesWrapper"></div>
            </div>

            <div class="input-container">
                <div class="input-wrapper">
                    <textarea id="messageInput" placeholder="Напишите ваш вопрос..." rows="1" maxlength="500"></textarea>
                    <button class="send-button" id="sendButton" aria-label="Отправить">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M2.01 21L23 12L2.01 3L2 10L17 12L2 14L2.01 21Z" fill="currentColor" />
                        </svg>
                    </button>
                </div>
                <div class="input-footer">
                    <span class="char-counter"><span id="charCount">0</span>/500</span>
                </div>
            </div>

            <div class="typing-indicator" id="typingIndicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    </div>`;

    const div = document.createElement('div');
    div.id = 'bot-integration-root';
    div.innerHTML = botHtml;
    document.body.appendChild(div);

    // 3. Load Scripts Sequentially
    function loadScript(index) {
        if (index >= SCRIPTS.length) return;

        const script = document.createElement('script');
        script.src = `${BASE_URL}/${SCRIPTS[index]}?v=${Date.now()}`;
        script.onload = () => loadScript(index + 1);
        document.body.appendChild(script);
    }

    loadScript(0);
})();
