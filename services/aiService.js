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

    /**
     * Ask the model to pick the best matching option from the full list.
     * @param {string} requestedValue
     * @param {Array<{value: string, label?: string, text?: string, index?: number}>} availableOptions
     * @param {string} context
     * @returns {Promise<object|null>}
     */
    async matchOption(requestedValue, availableOptions, context = '') {
        if (!this.initialized || !this.client) {
            throw new Error('AI Service not initialized. Set OPENAI_API_KEY environment variable.');
        }

        if (!Array.isArray(availableOptions) || availableOptions.length === 0) {
            return null;
        }

        const optionsList = availableOptions.map((opt, index) => {
            const label = opt.label || opt.text || '';
            const value = opt.value === undefined || opt.value === null ? '' : String(opt.value);
            return `${index + 1}. label="${label}" | value="${value}"`;
        }).join('\n');

        const prompt = `You are a smart form-option matcher. Pick the single best option for the user's requested value.

User requested: "${requestedValue}"

Available options (1-based index):
${optionsList}

${context ? `Additional context: ${context}` : ''}

Matching rules (in order):
1. Exact match on value or label/text
2. Abbreviations / aliases (e.g. "US" → "United States")
3. Numeric or quantity intent mapped into ranges
   - Example: requested "1" or "3" with options like "Less than 5", "6-50", "More than 50" → choose "Less than 5"
   - Example: requested "10" or "25" → choose "6-50"
   - Example: requested "100" → choose "More than 50"
4. Fuzzy / semantic closeness
5. Prefer real choices over placeholders like "Select...", "Choose...", empty value, or "N/A" unless the user clearly asked for those

Return ONLY the 1-based index number of the best option.
If nothing is a reasonable match, return 0.

Important country examples:
- "US" / "USA" / "United States" → prefer an option labeled USA or United States (NOT Australia)
- "UK" → United Kingdom
- "NZ" → New Zealand`;

        try {
            const response = await this.client.chat.completions.create({
                model: process.env.OPENAI_OPTION_MODEL || 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a precise option matcher. Reply with only a single integer index.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0,
                max_tokens: 10
            });

            const raw = (response.choices[0]?.message?.content || '').trim();
            const indexMatch = raw.match(/-?\d+/);
            const index = indexMatch ? parseInt(indexMatch[0], 10) : NaN;

            if (isNaN(index) || index < 0 || index > availableOptions.length) {
                throw new Error(`Invalid index returned by AI: ${raw}`);
            }

            if (index === 0) {
                return null;
            }

            const matched = availableOptions[index - 1];
            return matched
                ? { ...matched, index: typeof matched.index === 'number' ? matched.index : index - 1 }
                : null;
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
