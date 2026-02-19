import dotenv from 'dotenv';
import fetch from 'node-fetch';
dotenv.config();

async function test() {
    const apiKey = process.env.GROQ_API_KEY;
    console.log('API Key:', apiKey ? 'FOUND' : 'MISSING');
    if (!apiKey) return;

    try {
        console.log('Sending request to Groq...');
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: 'Привет' }]
            })
        });

        console.log('Status:', response.status);
        const data = await response.json();
        console.log('Response:', JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Error:', e.message);
    }
}

test();
