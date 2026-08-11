const { sessions } = require('../state');
const { getFirstTab } = require('../helpers/tabs');
const {
    normalizeOptionQuery,
    findBestOptionMatch,
    findFrameWithSelector,
    EVALUATE_SELECT_CONTEXT
} = require('../helpers/selectOptionMatching');
const { randomDelay } = require('../helpers/timing');
const AIService = require('../../../services/aiService');

/**
 * Select one or more options in a select element.
 * Resolves requested values against option value, label, and visible text, then selects them.
 * Supports AI-powered matching when useAI flag is enabled.
 *
 * AI agents often target an <option>, <optgroup>, <label>, or wrapper instead of <select>.
 * Native <select> is resolved from the matched element (self, parent, descendant, or label control).
 */
const selectOptionSession = async (req, res) => {
    const { sessionId } = req.params;
    const {
        selector,
        value,
        values,
        label,
        labels,
        text,
        texts,
        index,
        indexes,
        useAI = false,
        context = ''
    } = req.body ?? {};

    if (!selector) {
        return res.status(400).json({
            error: 'Selector is required'
        });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const requestedLabels = [
        ...(Array.isArray(values) ? values : value !== undefined ? [value] : []),
        ...(Array.isArray(labels) ? labels : label !== undefined ? [label] : []),
        ...(Array.isArray(texts) ? texts : text !== undefined ? [text] : []),
    ].filter(v => v !== undefined && v !== null).map(String);

    const requestedIndexes = [
        ...(Array.isArray(indexes) ? indexes : index !== undefined ? [index] : []),
    ].filter(v => v !== undefined && v !== null).map(Number);

    if (!requestedLabels.length && !requestedIndexes.length) {
        return res.status(400).json({
            error: 'Option selection is required',
            message: 'Provide value, values, label, labels, text, texts, index, or indexes'
        });
    }

    const session = sessions.get(sessionId);
    session.lastActivity = Date.now();

    try {
        const page = await getFirstTab(session);
        session.page = page;

        // Prefer a frame/select that actually has options (main page + iframes).
        let targetFrame = page.mainFrame();
        let selectContext = null;

        const probeFramesForSelect = async (activate) => {
            let best = null;
            let lastMiss = null;
            for (const frame of page.frames()) {
                try {
                    const result = await frame.evaluate(EVALUATE_SELECT_CONTEXT, selector, { activate });
                    if (!result) continue;

                    if (!result.found) {
                        lastMiss = { frame, result };
                        continue;
                    }

                    const optionScore = (result.options || []).length;
                    const customScore = (result.customOptions || []).length;
                    const score = optionScore * 1000 + customScore + 1;
                    if (!best || score > best.score) {
                        best = { frame, score, result };
                    }
                } catch (probeError) {
                    console.warn(`Select probe failed in frame: ${probeError.message}`);
                }
            }
            return best || (lastMiss ? { frame: lastMiss.frame, score: 0, result: lastMiss.result } : null);
        };

        // Quick wait for selector to appear somewhere.
        // LWC synthetic shadow often hides nodes from querySelector — do not fail hard here.
        try {
            await page.waitForSelector(selector, { visible: true, timeout: 3000 });
        } catch (_) {
            const frame = await findFrameWithSelector(page, selector, 5000);
            if (frame) {
                targetFrame = frame;
            } else {
                try {
                    await page.waitForSelector(selector, { timeout: 2000 });
                } catch (_) {
                    console.warn(
                        `waitForSelector miss for "${selector}"; falling back to deep/LWC DOM probe`
                    );
                }
            }
        }

        // Activate + poll while options hydrate asynchronously.
        const optionWaitDeadline = Date.now() + 8000;
        let probeAttempt = 0;
        while (Date.now() <= optionWaitDeadline) {
            const shouldActivate = probeAttempt === 0 || probeAttempt % 4 === 0;
            const best = await probeFramesForSelect(shouldActivate);
            probeAttempt += 1;
            if (best) {
                targetFrame = best.frame;
                selectContext = best.result;
                if ((selectContext.options || []).length > 0) break;
                if ((selectContext.customOptions || []).length > 0) break;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }

        if (!selectContext) {
            // Final probe without requiring options.
            const best = await probeFramesForSelect(false);
            if (best) {
                targetFrame = best.frame;
                selectContext = best.result;
            }
        }

        console.log(
            `🔍 Select resolve for "${selector}":`,
            selectContext?.found
                ? `native <select> via ${selectContext.elementTag} `
                    + `(${(selectContext.options || []).length} options, `
                    + `${selectContext.matchCount || 0} matches, `
                    + `${selectContext.selectCount || 0} selects)`
                : (selectContext?.reason || 'no_context')
        );

        let availableOptions = null;
        let isSelectElement = Boolean(selectContext?.found) && (selectContext.options || []).length > 0;
        let usesCustomOptions = false;

        if (selectContext?.found && (selectContext.options || []).length > 0) {
            availableOptions = selectContext.options;
            console.log(`📋 Available options count: ${availableOptions.length}`);
            console.log(
                '📋 Available options:',
                availableOptions.map((o) => `${o.value}: ${o.label}`).slice(0, 30)
            );
        } else if (selectContext?.found) {
            // Fallback: collect options via ElementHandle (covers some DOM edge cases).
            try {
                const selectHandle =
                    await targetFrame.$('select[data-browser-api-select-target="1"]')
                    || await targetFrame.$(selector);
                if (selectHandle) {
                    const handleOptions = await selectHandle.$$eval('option', (opts) =>
                        opts.map((opt, idx) => ({
                            value: opt.value,
                            label: String(opt.label || opt.textContent || opt.text || '').replace(/\s+/g, ' ').trim(),
                            text: String(opt.textContent || opt.text || '').replace(/\s+/g, ' ').trim(),
                            index: idx,
                            disabled: Boolean(opt.disabled)
                        }))
                    );
                    await selectHandle.dispose().catch(() => {});
                    if (handleOptions.length > 0) {
                        selectContext.options = handleOptions;
                        availableOptions = handleOptions;
                        isSelectElement = true;
                        console.log(`📋 Options via ElementHandle: ${handleOptions.length}`);
                    }
                }
            } catch (handleError) {
                console.warn(`ElementHandle option collection failed: ${handleError.message}`);
            }
        }

        if (!availableOptions && selectContext?.found && (selectContext.customOptions || []).length > 0) {
            // Empty native <select> with custom dropdown UI options nearby.
            availableOptions = selectContext.customOptions;
            usesCustomOptions = true;
            isSelectElement = false;
            console.log(`📋 Custom options count: ${availableOptions.length}`);
        } else if (!availableOptions && !selectContext?.found) {
            // Radio / checkbox / custom listbox fallbacks when no native <select> exists.
            availableOptions = await targetFrame.evaluate(sel => {
                const element = document.querySelector(sel);
                if (!element) return null;

                const tagName = element.tagName.toLowerCase();

                if (tagName === 'input' && element.type === 'radio') {
                    const name = element.name;
                    const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${name}"]`));
                    return radios.map(radio => ({
                        value: radio.value,
                        label: radio.parentElement?.textContent?.trim() || radio.value,
                        text: radio.parentElement?.textContent?.trim() || radio.value,
                        selector: `input[type="radio"][name="${name}"][value="${radio.value}"]`
                    }));
                }

                if (tagName === 'input' && element.type === 'checkbox') {
                    const name = element.name;
                    const checkboxes = Array.from(document.querySelectorAll(`input[type="checkbox"][name="${name}"]`));
                    return checkboxes.map(checkbox => ({
                        value: checkbox.value,
                        label: checkbox.parentElement?.textContent?.trim() || checkbox.value,
                        text: checkbox.parentElement?.textContent?.trim() || checkbox.value,
                        selector: `input[type="checkbox"][name="${name}"][value="${checkbox.value}"]`
                    }));
                }

                if (
                    element.getAttribute('role') === 'button'
                    || element.getAttribute('aria-haspopup')
                    || element.getAttribute('role') === 'combobox'
                ) {
                    element.click();
                }

                const optionNodes = Array.from(document.querySelectorAll(
                    '[role="option"], [data-radix-collection-item], li[data-value], div[data-value]'
                )).filter((node) => {
                    const style = window.getComputedStyle(node);
                    return style.display !== 'none' && style.visibility !== 'hidden';
                });

                if (optionNodes.length > 0) {
                    return optionNodes.map((node, idx) => ({
                        value: node.getAttribute('data-value')
                            || node.getAttribute('data-radix-collection-item')
                            || node.id
                            || String(idx),
                        label: (node.textContent || '').replace(/\s+/g, ' ').trim(),
                        text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
                        selector: null,
                        index: idx
                    }));
                }

                return [];
            }, selector);
        }

        if (!availableOptions || (Array.isArray(availableOptions) && availableOptions.length === 0)) {
            const diag = selectContext?.diagnostics
                ? ` Element snapshot: ${selectContext.diagnostics}`
                : '';
            const reason = selectContext?.found
                ? 'The <select> was found but has no <option> children yet (and no nearby custom options).'
                : `Could not locate selectable options (${selectContext?.reason || 'no_context'}). `
                    + 'On Salesforce LWC pages, retry after the form is fully rendered.';
            throw new Error(
                `Could not determine selectable options for element: ${selector}. `
                + reason
                + ' Wait for the field to finish loading if options are async.'
                + diag
            );
        }

        let finalQueries = [...requestedLabels];
        let aiResolvedOptions = [];
        const aiAttempted = new Set();

        /**
         * Resolve one requested query to an available option.
         * 1) Deterministic value/label/text match
         * 2) If useAI and no match → ask AI with the full options list
         */
        const resolveOptionForQuery = async (query, preloadedAiOption, queryKey = query) => {
            if (preloadedAiOption && (preloadedAiOption.index !== undefined || preloadedAiOption.value !== undefined)) {
                return preloadedAiOption;
            }

            const deterministic = findBestOptionMatch(availableOptions, query);
            if (deterministic) {
                return deterministic;
            }

            if (!useAI) {
                return null;
            }

            if (!AIService.isAvailable()) {
                console.warn(`⚠️ useAI=true but AI service unavailable while resolving "${query}"`);
                return null;
            }

            if (aiAttempted.has(queryKey)) {
                return null;
            }
            aiAttempted.add(queryKey);

            console.log(`🤖 No direct match for "${query}", asking AI with ${availableOptions.length} options...`);
            try {
                const matchedOption = await AIService.matchOption(query, availableOptions, context);
                if (matchedOption) {
                    console.log(`🎯 AI matched "${query}" → "${matchedOption.label || matchedOption.value}"`);
                } else {
                    console.log(`⚠️ AI found no reasonable match for "${query}"`);
                }
                return matchedOption;
            } catch (error) {
                console.error(`❌ AI matching failed for "${query}":`, error.message);
                return null;
            }
        };

        // Optional eager AI pass (kept for logging / aiMatching.matched response field).
        if (useAI && requestedLabels.length > 0 && AIService.isAvailable()) {
            console.log('🤖 Pre-resolving options with AI where helpful...');

            for (let i = 0; i < requestedLabels.length; i++) {
                const direct = findBestOptionMatch(availableOptions, requestedLabels[i]);
                if (direct) {
                    aiResolvedOptions[i] = direct;
                    if (direct.value !== undefined && direct.value !== null) {
                        finalQueries[i] = String(direct.value);
                    }
                    continue;
                }

                try {
                    aiAttempted.add(requestedLabels[i]);
                    const matchedOption = await AIService.matchOption(
                        requestedLabels[i],
                        availableOptions,
                        context
                    );

                    if (matchedOption) {
                        console.log(`🎯 AI matched "${requestedLabels[i]}" to "${matchedOption.label || matchedOption.value}"`);
                        if (matchedOption.value !== undefined && matchedOption.value !== null) {
                            finalQueries[i] = String(matchedOption.value);
                        } else {
                            finalQueries[i] = matchedOption.label || matchedOption.text || requestedLabels[i];
                        }
                        aiResolvedOptions[i] = matchedOption;
                    } else {
                        console.log(`⚠️ AI could not find match for "${requestedLabels[i]}" during pre-resolve`);
                    }
                } catch (error) {
                    console.error(`❌ AI pre-resolve failed for "${requestedLabels[i]}":`, error.message);
                }
            }
        } else if (useAI && !AIService.isAvailable()) {
            console.warn('⚠️ useAI=true but OPENAI_API_KEY is not configured / AI service unavailable');
        }

        let selectedValues = [];
        let selectedOptions = [];

        if (isSelectElement) {
            const resolvedIndexes = [];

            for (let i = 0; i < finalQueries.length; i++) {
                const query = finalQueries[i];
                const matched = await resolveOptionForQuery(query, aiResolvedOptions[i]);

                if (!matched) {
                    // Last chance: if original requested label differs from finalQueries (AI rewrote it), retry original.
                    const original = requestedLabels[i];
                    const fallback = original && original !== query
                        ? await resolveOptionForQuery(original, null)
                        : null;

                    if (!fallback) {
                        const availableSummary = availableOptions
                            .slice(0, 20)
                            .map((opt) => `${opt.value} ("${opt.label || opt.text}")`)
                            .join(', ');
                        const aiHint = useAI
                            ? (AIService.isAvailable()
                                ? ' AI also found no suitable match.'
                                : ' useAI was true but AI service is unavailable (set OPENAI_API_KEY).')
                            : ' Pass useAI:true to let AI pick the closest option.';
                        throw new Error(
                            `No option found matching "${query}". Available options: ${availableSummary}`
                            + `${availableOptions.length > 20 ? ', ...' : ''}.${aiHint}`
                        );
                    }

                    const fallbackIndex = typeof fallback.index === 'number'
                        ? fallback.index
                        : availableOptions.indexOf(fallback);
                    if (fallbackIndex < 0 || fallbackIndex >= availableOptions.length) {
                        throw new Error(`Resolved option index out of range for "${original}"`);
                    }
                    resolvedIndexes.push(fallbackIndex);
                    aiResolvedOptions[i] = fallback;
                    finalQueries[i] = fallback.value !== undefined && fallback.value !== null
                        ? String(fallback.value)
                        : (fallback.label || fallback.text || original);
                    continue;
                }

                const matchedIndex = typeof matched.index === 'number'
                    ? matched.index
                    : availableOptions.findIndex((opt) =>
                        opt.value === matched.value
                        && normalizeOptionQuery(opt.label) === normalizeOptionQuery(matched.label || matched.text)
                    );

                if (matchedIndex < 0 || matchedIndex >= availableOptions.length) {
                    // Prefer indexOf if findIndex failed due to label normalization.
                    const byRef = availableOptions.indexOf(matched);
                    if (byRef >= 0) {
                        resolvedIndexes.push(byRef);
                        continue;
                    }
                    throw new Error(`Resolved option index out of range for "${query}"`);
                }

                resolvedIndexes.push(matchedIndex);
                aiResolvedOptions[i] = matched;
            }

            for (const requestedIndex of requestedIndexes) {
                if (!Number.isInteger(requestedIndex) || requestedIndex < 0 || requestedIndex >= availableOptions.length) {
                    throw new Error(`Option index out of range: ${requestedIndex}`);
                }
                resolvedIndexes.push(requestedIndex);
            }

            // Apply selection on the resolved <select> (deep query for LWC synthetic shadow).
            const applyResult = await targetFrame.evaluate((sel, optionIndexes) => {
                const querySelectorAllDeep = (selector, root = document) => {
                    const results = [];
                    const seen = new Set();
                    const tryMatch = (el) => {
                        if (!el || el.nodeType !== 1 || seen.has(el)) return;
                        seen.add(el);
                        try {
                            if (el.matches?.(selector)) results.push(el);
                        } catch (_) {}
                    };
                    try {
                        const start = root.body || root.documentElement || root;
                        if (start && start.nodeType === 1) {
                            tryMatch(start);
                            const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
                            let current = walker.currentNode;
                            while (current) {
                                tryMatch(current);
                                if (current.shadowRoot) {
                                    const srWalker = document.createTreeWalker(
                                        current.shadowRoot,
                                        NodeFilter.SHOW_ELEMENT
                                    );
                                    let srNode = srWalker.currentNode;
                                    while (srNode) {
                                        tryMatch(srNode);
                                        srNode = srWalker.nextNode();
                                    }
                                }
                                current = walker.nextNode();
                            }
                        }
                    } catch (_) {}
                    try {
                        const quick = root.querySelectorAll?.(selector);
                        if (quick) {
                            for (const el of quick) {
                                if (!seen.has(el)) {
                                    seen.add(el);
                                    results.push(el);
                                }
                            }
                        }
                    } catch (_) {}
                    return results;
                };

                let selectEl = null;

                // Prefer selects matching the request selector (never a stale mark from another field).
                {
                    const matched = querySelectorAllDeep(sel);
                    const selects = matched
                        .map((el) => {
                            if (!el) return null;
                            if (el.tagName && el.tagName.toLowerCase() === 'select') return el;
                            return el.closest?.('select') || querySelectorAllDeep('select', el)[0];
                        })
                        .filter(Boolean);
                    selectEl = selects.sort(
                        (a, b) => (b.options?.length || 0) - (a.options?.length || 0)
                    )[0] || null;
                }

                if (!selectEl) {
                    selectEl =
                        querySelectorAllDeep('select[data-browser-api-select-target="1"]')[0] || null;
                }

                if (!selectEl) {
                    const nameMatch = /\[name=['"]([^'"]+)['"]\]/.exec(sel);
                    if (nameMatch) {
                        selectEl = querySelectorAllDeep('select').find(
                            (el) => el.getAttribute('name') === nameMatch[1]
                        ) || null;
                    }
                }

                if (!selectEl) {
                    const idMatch = /^#([\w:-]+)$/.exec(sel) || /\[id=['"]([^'"]+)['"]\]/.exec(sel);
                    if (idMatch) {
                        selectEl = querySelectorAllDeep('select').find(
                            (el) => el.id === idMatch[1]
                        ) || null;
                    }
                }

                if (!selectEl || selectEl.tagName.toLowerCase() !== 'select') {
                    throw new Error(`Could not resolve target <select> for selector: ${sel}`);
                }

                let options = [];
                try {
                    options = Array.from(selectEl.options || []);
                } catch (_) {}
                if (!options.length) {
                    options = Array.from(selectEl.querySelectorAll?.('option') || []);
                }

                const uniqueIndexes = [...new Set(optionIndexes.map(Number))];
                const isMultiple = Boolean(selectEl.multiple);

                for (const option of options) {
                    option.selected = false;
                }

                if (isMultiple) {
                    for (const idx of uniqueIndexes) {
                        if (!options[idx]) {
                            throw new Error(`Option index out of range while selecting: ${idx}`);
                        }
                        options[idx].selected = true;
                    }
                } else {
                    const targetIndex = uniqueIndexes[uniqueIndexes.length - 1];
                    if (!options[targetIndex]) {
                        throw new Error(`Option index out of range while selecting: ${targetIndex}`);
                    }
                    selectEl.selectedIndex = targetIndex;
                    options[targetIndex].selected = true;
                    selectEl.value = options[targetIndex].value;
                }

                // Fire events LWC / Lightning expect.
                selectEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                selectEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                try {
                    selectEl.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
                } catch (_) {}

                return {
                    selectedValues: Array.from(selectEl.selectedOptions).map((option) => option.value),
                    selectedOptions: Array.from(selectEl.selectedOptions).map((option) => ({
                        value: option.value,
                        label: option.label,
                        text: option.text
                    }))
                };
            }, selector, resolvedIndexes);

            selectedValues = applyResult.selectedValues;
            selectedOptions = applyResult.selectedOptions;

            if (!selectedOptions.length) {
                throw new Error(`Failed to select option(s) for selector: ${selector}`);
            }
        } else {
            const matchedOptions = [];

            for (let i = 0; i < finalQueries.length; i++) {
                const query = finalQueries[i];
                const matchedOption = await resolveOptionForQuery(query, aiResolvedOptions[i]);
                if (!matchedOption) {
                    const availableSummary = availableOptions
                        .slice(0, 20)
                        .map((opt) => `${opt.value} ("${opt.label || opt.text}")`)
                        .join(', ');
                    throw new Error(
                        `No option found matching: ${query}. Available options: ${availableSummary}`
                        + `${availableOptions.length > 20 ? ', ...' : ''}`
                    );
                }
                matchedOptions.push(matchedOption);
                aiResolvedOptions[i] = matchedOption;
                finalQueries[i] = matchedOption.value !== undefined && matchedOption.value !== null
                    ? String(matchedOption.value)
                    : (matchedOption.label || matchedOption.text || query);
            }

            for (const matchedOption of matchedOptions) {
                if (matchedOption.selector) {
                    await targetFrame.click(matchedOption.selector);
                } else if (typeof matchedOption.index === 'number') {
                    await targetFrame.evaluate((idx, scopedToSelect) => {
                        const scope = scopedToSelect
                            ? (
                                document.querySelector('select[data-browser-api-select-target="1"]')?.closest(
                                    'div, span, fieldset, form, li, td, th, section, article, label'
                                )
                                || document
                            )
                            : document;

                        const optionNodes = Array.from(scope.querySelectorAll(
                            '[role="option"], [data-radix-collection-item], li[data-value], div[data-value]'
                        )).filter((node) => {
                            const style = window.getComputedStyle(node);
                            return style.display !== 'none' && style.visibility !== 'hidden';
                        });
                        const node = optionNodes[idx];
                        if (!node) {
                            throw new Error(`Custom option at index ${idx} not found`);
                        }
                        node.click();
                    }, matchedOption.index, usesCustomOptions);
                } else {
                    await targetFrame.click(selector);
                }
                await new Promise(resolve => setTimeout(resolve, randomDelay(50, 150)));
            }

            // If a native empty select exists, also try syncing value for form libs.
            if (usesCustomOptions) {
                await targetFrame.evaluate((valuesToSelect) => {
                    const selectEl = document.querySelector('select[data-browser-api-select-target="1"]');
                    if (!selectEl) return;
                    const target = String(valuesToSelect[valuesToSelect.length - 1] ?? '');
                    const options = Array.from(selectEl.options || []);
                    const match = options.find((opt) => opt.value === target)
                        || options.find((opt) => (opt.label || opt.textContent || '').trim() === target);
                    if (match) {
                        selectEl.value = match.value;
                        match.selected = true;
                        selectEl.dispatchEvent(new Event('input', { bubbles: true }));
                        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, matchedOptions.map((opt) => opt.value));
            }

            selectedValues = matchedOptions.map((opt) => opt.value);
            selectedOptions = matchedOptions.map((opt) => ({
                value: opt.value,
                label: opt.label,
                text: opt.text
            }));
        }

        res.json({
            success: true,
            sessionId,
            selector,
            selectedValues,
            selectedOptions,
            aiMatching: {
                enabled: useAI,
                available: AIService.isAvailable(),
                requested: requestedLabels,
                matched: useAI
                    ? (aiResolvedOptions.length
                        ? aiResolvedOptions.map((opt) => (opt
                            ? (opt.label || opt.text || opt.value)
                            : null))
                        : finalQueries)
                    : null
            }
        });
    } catch (error) {
        console.error('Error selecting option:', error);
        res.status(500).json({
            error: 'Failed to select option',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

module.exports = { selectOptionSession };
