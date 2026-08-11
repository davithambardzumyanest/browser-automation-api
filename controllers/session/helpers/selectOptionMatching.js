// Option-matching/scoring logic for selectOptionSession, plus the
// findFrameWithSelector helper also used by clickSession.
//
// Select one or more options in a select element. Resolves requested values
// against option value, label, and visible text, then selects them.
//
// AI agents often target an <option>, <optgroup>, <label>, or wrapper instead
// of <select>. Native <select> is resolved from the matched element (self,
// parent, descendant, or label control).
const normalizeOptionQuery = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Common aliases so "US" / "United States" resolve to "USA", etc. */
const OPTION_ALIAS_GROUPS = [
    ['us', 'usa', 'u.s.', 'u.s.a.', 'united states', 'united states of america', 'america'],
    ['uk', 'u.k.', 'united kingdom', 'britain', 'great britain', 'england', 'gb'],
    ['nz', 'new zealand'],
    ['au', 'aus', 'australia'],
    ['ca', 'can', 'canada'],
    ['uae', 'united arab emirates'],
    ['kr', 'south korea', 'korea, republic of', 'republic of korea'],
    ['kp', 'north korea'],
    ['ru', 'russia', 'russian federation'],
    ['de', 'germany', 'deutschland'],
    ['fr', 'france'],
    ['es', 'spain'],
    ['it', 'italy'],
    ['jp', 'japan'],
    ['cn', 'china', 'prc', "people's republic of china"],
    ['in', 'india'],
    ['br', 'brazil'],
    ['mx', 'mexico'],
];

const expandOptionAliases = (query) => {
    const q = normalizeOptionQuery(query).toLowerCase();
    if (!q) return [];
    const expanded = new Set([q]);
    for (const group of OPTION_ALIAS_GROUPS) {
        if (group.includes(q)) {
            for (const alias of group) expanded.add(alias);
        }
    }
    return [...expanded];
};

const optionCandidateTexts = (option) => [
    option.value,
    option.label,
    option.text,
].map(normalizeOptionQuery).filter((v) => v !== '');

/**
 * Score how well an option matches a query. Higher is better; 0 = no match.
 * Avoids false positives like query "US" matching "Australia" via substring includes.
 */
const scoreOptionMatch = (option, query) => {
    const normalizedQuery = normalizeOptionQuery(query);
    if (!normalizedQuery) return 0;

    const queryLower = normalizedQuery.toLowerCase();
    const aliases = expandOptionAliases(queryLower);
    const candidates = optionCandidateTexts(option);
    if (!candidates.length) return 0;

    let best = 0;

    for (const candidate of candidates) {
        const candidateLower = candidate.toLowerCase();

        // Exact value/label/text
        if (candidateLower === queryLower) {
            best = Math.max(best, 100);
            continue;
        }

        // Alias exact (US → USA, United States → USA)
        if (aliases.some((alias) => alias === candidateLower)) {
            best = Math.max(best, 90);
            continue;
        }

        // Short queries (≤2 chars): exact / alias only — never substring.
        if (queryLower.length <= 2) {
            continue;
        }

        // Whole-word boundary match (query "kingdom" in "United Kingdom")
        const wordRe = new RegExp(`(^|[^a-z0-9])${escapeRegex(queryLower)}([^a-z0-9]|$)`, 'i');
        if (wordRe.test(candidateLower)) {
            best = Math.max(best, 70);
            continue;
        }

        // Alias as whole word inside candidate
        if (aliases.some((alias) => {
            if (alias.length <= 2) return false;
            const aliasRe = new RegExp(`(^|[^a-z0-9])${escapeRegex(alias)}([^a-z0-9]|$)`, 'i');
            return aliasRe.test(candidateLower);
        })) {
            best = Math.max(best, 65);
            continue;
        }

        // Prefix match for longer queries ("United St" → "United States")
        if (queryLower.length >= 4 && candidateLower.startsWith(queryLower)) {
            best = Math.max(best, 50);
            continue;
        }

        // Contains only when query is reasonably long (avoids "us" in "australia")
        if (queryLower.length >= 4 && candidateLower.includes(queryLower)) {
            best = Math.max(best, 30);
            continue;
        }
    }

    return best;
};

const optionMatchesQuery = (option, query) => scoreOptionMatch(option, query) > 0;

/** Pick the single best-scoring option (undefined if none score > 0). */
const findBestOptionMatch = (options, query) => {
    let best = null;
    let bestScore = 0;

    for (const option of options) {
        const score = scoreOptionMatch(option, query);
        if (score > bestScore) {
            bestScore = score;
            best = option;
        }
    }

    return bestScore > 0 ? best : null;
};

/** Find a Puppeteer frame that contains the selector (main page + iframes). */
const findFrameWithSelector = async (page, selector, timeoutMs = 10000) => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const frames = page.frames();
        for (const frame of frames) {
            try {
                // Try normal + pierce (open shadow) selectors.
                const handle =
                    await frame.$(selector)
                    || await frame.$(`pierce/${selector}`).catch(() => null);
                if (handle) {
                    await handle.dispose().catch(() => {});
                    return frame;
                }
            } catch (_) {
                // Frame may be detaching during navigation.
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }

    return null;
};

/**
 * In-page: resolve <select> + options.
 * Uses TreeWalker / shadow piercing because Salesforce LWC synthetic shadow
 * patches document.querySelector* and hides internal nodes from querySelectorAll.
 */
const EVALUATE_SELECT_CONTEXT = (sel, { activate = false } = {}) => {
    const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

    const isVisible = (el) => {
        if (!el) return false;
        try {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }
            const rect = el.getBoundingClientRect();
            return rect.width > 0 || rect.height > 0;
        } catch (_) {
            return false;
        }
    };

    /** Walk real DOM + open shadow roots; bypasses LWC-patched querySelector. */
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

        const walk = (node) => {
            if (!node) return;

            if (node.nodeType === 1) {
                tryMatch(node);

                // Native open shadow
                if (node.shadowRoot) {
                    walk(node.shadowRoot);
                }

                // Some LWC / web-component hosts expose closed-looking trees via children.
                const children = node.children || [];
                for (let i = 0; i < children.length; i++) {
                    walk(children[i]);
                }
                return;
            }

            // Document / DocumentFragment / ShadowRoot
            const childNodes = node.childNodes || [];
            for (let i = 0; i < childNodes.length; i++) {
                walk(childNodes[i]);
            }
        };

        // TreeWalker finds LWC synthetic-shadow scoped nodes that querySelector hides.
        try {
            const start = root.body || root.documentElement || root;
            if (start && start.nodeType === 1) {
                tryMatch(start);
                const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
                let current = walker.currentNode;
                while (current) {
                    tryMatch(current);
                    if (current.shadowRoot) walk(current.shadowRoot);
                    current = walker.nextNode();
                }
            } else {
                walk(root);
            }
        } catch (_) {
            walk(root.body || root);
        }

        // Fallback: unpatched path in case matches() / TreeWalker blocked.
        try {
            const quick = root.querySelectorAll?.(selector);
            if (quick && quick.length) {
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

    const collectSelectOptions = (selectEl) => {
        if (!selectEl || selectEl.tagName.toLowerCase() !== 'select') return [];

        let optionEls = [];
        try {
            if (selectEl.options && selectEl.options.length > 0) {
                optionEls = Array.from(selectEl.options);
            }
        } catch (_) {}

        if (!optionEls.length) {
            optionEls = Array.from(selectEl.querySelectorAll?.('option') || []);
        }
        if (!optionEls.length) {
            optionEls = querySelectorAllDeep('option', selectEl);
        }
        if (!optionEls.length && selectEl.shadowRoot) {
            optionEls = Array.from(selectEl.shadowRoot.querySelectorAll('option'));
        }

        return optionEls.map((opt, idx) => ({
            value: opt.value,
            label: normalizeText(opt.label || opt.textContent || opt.text || ''),
            text: normalizeText(opt.textContent || opt.text || ''),
            index: idx,
            disabled: Boolean(opt.disabled)
        }));
    };

    const resolveNativeSelect = (element) => {
        if (!element) return null;
        const tag = element.tagName.toLowerCase();

        if (tag === 'select') return element;
        if (tag === 'option' || tag === 'optgroup') {
            return element.closest?.('select') || null;
        }

        if (tag === 'label') {
            if (element.control && element.control.tagName.toLowerCase() === 'select') {
                return element.control;
            }
            const forId = element.getAttribute('for');
            if (forId) {
                const labeled = querySelectorAllDeep(
                    `#${(typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(forId) : forId.replace(/([^\w-])/g, '\\$1')}`
                )[0] || document.getElementById(forId);
                if (labeled && labeled.tagName.toLowerCase() === 'select') {
                    return labeled;
                }
            }
        }

        const nested = querySelectorAllDeep('select', element)[0];
        if (nested) return nested;

        const container = element.closest?.('div, span, fieldset, form, li, td, th, section, article, label');
        if (container) {
            const nearby = querySelectorAllDeep('select', container)[0];
            if (nearby) return nearby;
        }

        return null;
    };

    const collectCustomOptionsNear = (rootEl) => {
        if (!rootEl) return [];

        const scope =
            rootEl.closest?.('div, span, fieldset, form, li, td, th, section, article, label')
            || rootEl.parentElement
            || document.body
            || document;

        const triggers = [
            rootEl,
            ...querySelectorAllDeep(
                '[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="true"], button, [role="button"]',
                scope
            )
        ];
        for (const trigger of triggers.slice(0, 6)) {
            try {
                if (typeof trigger.focus === 'function') trigger.focus();
                if (typeof trigger.click === 'function') trigger.click();
            } catch (_) {}
        }

        const optionNodes = querySelectorAllDeep(
            'option, [role="option"], [data-radix-collection-item], li[data-value], div[data-value], li[role="option"], button[role="option"]',
            scope
        ).filter((node) => {
            if (node.tagName && node.tagName.toLowerCase() === 'option') {
                return !node.disabled;
            }
            try {
                const style = window.getComputedStyle(node);
                return style.display !== 'none' && style.visibility !== 'hidden';
            } catch (_) {
                return true;
            }
        });

        return optionNodes.map((node, idx) => {
            const tag = node.tagName.toLowerCase();
            if (tag === 'option') {
                return {
                    value: node.value,
                    label: normalizeText(node.label || node.textContent || node.text || ''),
                    text: normalizeText(node.textContent || node.text || ''),
                    index: idx,
                    disabled: Boolean(node.disabled),
                    source: 'option'
                };
            }

            return {
                value: node.getAttribute('data-value')
                    || node.getAttribute('data-radix-collection-item')
                    || node.id
                    || String(idx),
                label: normalizeText(node.textContent || ''),
                text: normalizeText(node.textContent || ''),
                index: idx,
                selector: null,
                source: 'custom'
            };
        }).filter((opt) => opt.label || opt.text || (opt.value !== undefined && opt.value !== null));
    };

    let matched = [];
    try {
        matched = querySelectorAllDeep(sel);
    } catch (err) {
        return { found: false, reason: `query_error: ${err.message}`, matchCount: 0 };
    }

    if (!matched.length) {
        // Last resort for forms: any select with matching name= from selector.
        const nameMatch = /\[name=['"]([^'"]+)['"]\]/.exec(sel);
        if (nameMatch) {
            matched = querySelectorAllDeep('select').filter(
                (el) => el.getAttribute('name') === nameMatch[1]
            );
        }
    }

    if (!matched.length) {
        return { found: false, reason: 'element_not_found', matchCount: 0 };
    }

    const selects = [];
    for (const el of matched) {
        const selectEl = resolveNativeSelect(el);
        if (selectEl && !selects.includes(selectEl)) {
            selects.push(selectEl);
        }
    }

    if (!selects.length) {
        return {
            found: false,
            reason: 'no_native_select',
            matchCount: matched.length,
            elementTag: matched[0].tagName.toLowerCase(),
            elementType: matched[0].type || null
        };
    }

    const ranked = selects
        .map((selectEl) => {
            const options = collectSelectOptions(selectEl);
            return {
                selectEl,
                options,
                optionCount: options.length,
                visible: isVisible(selectEl),
                id: selectEl.id || null,
                name: selectEl.name || null,
                multiple: Boolean(selectEl.multiple),
                outerHTML: (selectEl.outerHTML || '').slice(0, 500)
            };
        })
        .sort((a, b) => {
            if (b.optionCount !== a.optionCount) return b.optionCount - a.optionCount;
            if (a.visible !== b.visible) return a.visible ? -1 : 1;
            return 0;
        });

    let best = ranked[0];

    if (activate && best.selectEl) {
        try {
            best.selectEl.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
        } catch (_) {}
        try {
            best.selectEl.focus();
        } catch (_) {}
    }

    const options = collectSelectOptions(best.selectEl);
    best = { ...best, options, optionCount: options.length };

    // Clear previous marks site-wide, then mark the chosen select for this request.
    try {
        for (const el of querySelectorAllDeep('select[data-browser-api-select-target]')) {
            el.removeAttribute('data-browser-api-select-target');
        }
    } catch (_) {}
    for (const item of ranked) {
        try {
            item.selectEl.removeAttribute('data-browser-api-select-target');
        } catch (_) {}
    }
    try {
        best.selectEl.setAttribute('data-browser-api-select-target', '1');
    } catch (_) {}

    let customOptions = [];
    if (best.optionCount === 0) {
        customOptions = collectCustomOptionsNear(best.selectEl);
        const nativeFromCustom = customOptions.filter((o) => o.source === 'option');
        if (nativeFromCustom.length > 0) {
            return {
                found: true,
                elementTag: matched[0].tagName.toLowerCase(),
                selectTag: 'select',
                selectId: best.id,
                selectName: best.name,
                multiple: best.multiple,
                matchCount: matched.length,
                selectCount: selects.length,
                options: nativeFromCustom.map((o, idx) => ({ ...o, index: idx })),
                diagnostics: best.outerHTML
            };
        }
    }

    return {
        found: true,
        elementTag: matched[0].tagName.toLowerCase(),
        selectTag: 'select',
        selectId: best.id,
        selectName: best.name,
        multiple: best.multiple,
        matchCount: matched.length,
        selectCount: selects.length,
        options: best.options,
        customOptions,
        diagnostics: best.outerHTML
    };
};

module.exports = { normalizeOptionQuery, findBestOptionMatch, findFrameWithSelector, EVALUATE_SELECT_CONTEXT };
