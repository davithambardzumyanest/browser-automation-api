const OpenAI = require('openai');

class AIService {
    constructor() {
        this.client = null;
        this.initialized = false;
    }

    initialize() {
        if (this.initialized) return;

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.warn('⚠️ OPENAI_API_KEY not set. AI-powered features will be disabled.');
            return;
        }

        this.client = new OpenAI({
            apiKey: apiKey
        });
        this.initialized = true;
        console.log('✅ AI Service initialized');
    }

    async matchOption(requestedValue, availableOptions, context = '') {
        if (!this.initialized || !this.client) {
            throw new Error('AI Service not initialized. Set OPENAI_API_KEY environment variable.');
        }

        const optionsList = availableOptions.map((opt, index) => 
            `${index + 1}. ${opt.label || opt.text || opt.value} (value: ${opt.value})`
        ).join('\n');

        const prompt = `You are a smart option matcher. Given a user's requested value and a list of available options, select the best match.

User requested: "${requestedValue}"

Available options:
${optionsList}

${context ? `Context: ${context}` : ''}

Return ONLY the index number (1-based) of the best matching option. Consider:
- Exact matches first
- Abbreviations (e.g., "US" matches "United States" or "USA")
- Similar spellings
- Common variations

If no reasonable match exists, return 0.`;

        try {
            const response = await this.client.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a precise option matcher. Return only the index number.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.1,
                max_tokens: 10
            });

            const result = response.choices[0].message.content.trim();
            const index = parseInt(result, 10);

            if (isNaN(index) || index < 0 || index > availableOptions.length) {
                throw new Error(`Invalid index returned by AI: ${result}`);
            }

            return index === 0 ? null : availableOptions[index - 1];
        } catch (error) {
            console.error('❌ AI matching error:', error.message);
            throw new Error(`AI matching failed: ${error.message}`);
        }
    }

    isAvailable() {
        return this.initialized && this.client !== null;
    }
}

module.exports = new AIService();
