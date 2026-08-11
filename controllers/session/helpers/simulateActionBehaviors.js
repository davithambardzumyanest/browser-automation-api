// Human-like scroll/mouse/typing/navigation simulation used by simulateUserActions.
const { wait, randomDelay } = require('./timing');

// Function to generate a bezier curve for more natural mouse movement
function generateBezierPoints(start, end, controlPoints = 3) {
    const points = [];
    for (let i = 0; i <= controlPoints; i++) {
        const t = i / controlPoints;
        // Add some randomness to the control points
        const cp1x = start.x + (end.x - start.x) * 0.3 + (Math.random() * 100 - 50);
        const cp1y = start.y + (end.y - start.y) * 0.3 + (Math.random() * 100 - 50);
        const cp2x = start.x + (end.x - start.x) * 0.7 + (Math.random() * 100 - 50);
        const cp2y = start.y + (end.y - start.y) * 0.7 + (Math.random() * 100 - 50);

        // Cubic bezier curve formula
        const x = Math.pow(1-t, 3) * start.x +
                 3 * Math.pow(1-t, 2) * t * cp1x +
                 3 * (1-t) * t * t * cp2x +
                 t * t * t * end.x;

        const y = Math.pow(1-t, 3) * start.y +
                 3 * Math.pow(1-t, 2) * t * cp1y +
                 3 * (1-t) * t * t * cp2y +
                 t * t * t * end.y;

        points.push({x, y});
    }
    return points;
}

// Function to get current mouse position
async function getMousePosition(page) {
    return page.evaluate(() => {
        return {
            x: window.mouseX || 0,
            y: window.mouseY || 0
        };
    });
}

// Function to simulate human-like mouse movement with bezier curves
async function moveMouse(page, targetX, targetY) {
    const currentPos = await getMousePosition(page);
    const start = { x: currentPos.x || 0, y: currentPos.y || 0 };
    const end = { x: targetX, y: targetY };

    // Don't move if already at target
    if (Math.abs(start.x - end.x) < 5 && Math.abs(start.y - end.y) < 5) {
        return;
    }

    // Generate bezier curve points
    const points = generateBezierPoints(start, end);

    // Move through each point
    for (const point of points) {
        await page.mouse.move(point.x, point.y, { steps: 1 });
        await wait(30 + Math.random() * 30); // Variable speed
    }

    // Ensure we reach the exact target
    await page.mouse.move(end.x, end.y, { steps: 1 });
    await wait(randomDelay(50, 200));

    // Update mouse position in page context
    await page.evaluate((x, y) => {
        window.mouseX = x;
        window.mouseY = y;
    }, end.x, end.y);
}

// Function to simulate human-like scrolling
async function randomScroll(page) {
    const viewport = await page.viewport();
    const maxScroll = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);

    if (maxScroll <= 0) return;

    // Decide scroll direction and amount
    const direction = Math.random() > 0.5 ? 1 : -1;
    const baseScroll = Math.min(viewport.height * 0.7, maxScroll * 0.2);
    const scrollAmount = Math.floor(baseScroll * (0.8 + Math.random() * 0.4) * direction);

    // Get current scroll position
    const currentScroll = await page.evaluate(() => window.scrollY);
    const targetScroll = Math.max(0, Math.min(currentScroll + scrollAmount, maxScroll));

    // Scroll in smaller chunks with easing
    const steps = 10 + Math.floor(Math.random() * 10);
    const stepSize = (targetScroll - currentScroll) / steps;

    for (let i = 0; i < steps; i++) {
        const progress = i / (steps - 1);
        // Easing function (easeInOutQuad)
        const easeProgress = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        const currentStep = currentScroll + (targetScroll - currentScroll) * easeProgress;

        await page.evaluate((y) => {
            window.scrollTo({ top: y, behavior: 'instant' });
        }, currentStep);

        // Variable delay between scroll steps
        await wait(30 + Math.random() * 50);
    }

    // Small random delay after scrolling
    await wait(randomDelay(300, 1200));
}

// Function to simulate random mouse movements
async function randomMouseMovements(page) {
    const viewport = page.viewport();
    const x = Math.floor(Math.random() * viewport.width);
    const y = Math.floor(Math.random() * viewport.height);
    await moveMouse(page, x, y);
}

// Function to simulate random clicks on interactive elements
async function randomClicks(page) {
    const clickableElements = await page.$$('a, button, [role="button"], [onclick]');
    if (clickableElements.length > 0) {
        const randomIndex = Math.floor(Math.random() * clickableElements.length);
        try {
            await clickableElements[randomIndex].click({ delay: randomDelay(50, 200) });
            await wait(randomDelay(1000, 3000));
            // Go back if we navigated
            if (page.url() !== 'about:blank') {
                await page.reload();
                await wait(randomDelay(1000, 2000));
            }
        } catch (error) {
            console.log(error);
            console.log('Could not click element, continuing...');
        }
    }
}

// Additional realistic non-intrusive actions
async function randomWheelScroll(page) {
    try {
        const deltaY = (Math.random() > 0.5 ? 1 : -1) * randomDelay(100, 600);
        const deltaX = Math.random() < 0.1 ? randomDelay(-60, 60) : 0;
        await page.mouse.wheel({ deltaY, deltaX });
        await wait(randomDelay(200, 800));
    } catch (_) {}
}

async function randomKeyPresses(page) {
    const keys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'End', 'Enter', 'Enter', 'Enter', 'Enter', 'Enter', 'Enter'];
    const presses = randomDelay(1, 3);
    for (let i = 0; i < presses; i++) {
        const key = keys[Math.floor(Math.random() * keys.length)];
        try {
            await page.keyboard.press(key, { delay: randomDelay(10, 80) });
        } catch (_) {}
        await wait(randomDelay(100, 300));
    }
}

// Function to simulate natural mouse movements during typing
async function moveMouseNaturally(page, element, durationMs) {
    const box = await element.boundingBox();
    if (!box) return;

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    const startTime = Date.now();
    const endTime = startTime + durationMs;

    // Define movement boundaries (slightly larger than the element)
    const padding = Math.min(box.width, box.height) * 0.5;
    const minX = box.x - padding;
    const maxX = box.x + box.width + padding;
    const minY = box.y - padding;
    const maxY = box.y + box.height + padding;

    let lastX = startX;
    let lastY = startY;

    // Continue moving until time is up
    while (Date.now() < endTime) {
        // Calculate new target position within boundaries
        const targetX = Math.max(minX, Math.min(maxX, lastX + (Math.random() - 0.5) * 40));
        const targetY = Math.max(minY, Math.min(maxY, lastY + (Math.random() - 0.5) * 20));

        // Move to new position
        await page.mouse.move(targetX, targetY, { steps: 3 });

        // Small random delay
        await wait(50 + Math.random() * 100);

        lastX = targetX;
        lastY = targetY;
    }

    // Return to the center of the element
    await page.mouse.move(startX, startY, { steps: 5 });
}

// Function to simulate human-like typing with natural variations and mouse movements
async function humanTypeText(page, element, text) {
    try {
        // First try to focus the element
        try {
            await element.focus();
            await wait(randomDelay(50, 200));
        } catch (e) {
            console.log('Could not focus element, trying to click it first');
            const box = await element.boundingBox();
            if (box) {
                await moveMouse(page, box.x + box.width / 2, box.y + box.height / 2);
                await element.click({ delay: randomDelay(30, 100) });
                await wait(randomDelay(200, 500));
            }
        }

        // Calculate typing duration (2 seconds minimum, up to 10 seconds for longer text)
        const baseDuration = Math.min(10000, Math.max(2000, text.length * 100));
        const typingStartTime = Date.now();
        let lastMouseMoveTime = 0;

        // Type each character with variable speed
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const currentTime = Date.now();
            const elapsedTime = currentTime - typingStartTime;

            // Randomly make typing mistakes (5% chance)
            if (Math.random() < 0.05) {
                const mistake = String.fromCharCode(char.charCodeAt(0) + (Math.random() > 0.5 ? 1 : -1));
                await page.keyboard.type(mistake, { delay: randomDelay(30, 100) });
                await wait(randomDelay(50, 150));
                await page.keyboard.press('Backspace', { delay: randomDelay(20, 50) });
                await wait(randomDelay(50, 150));
            }

            // Type the actual character with variable speed
            const delay = randomDelay(30, 150) * (Math.random() > 0.9 ? 2 : 1);
            await page.keyboard.type(char, { delay });

            // Random pause between words or sometimes in the middle
            const shouldPause = (char === ' ' && Math.random() > 0.7) || Math.random() > 0.95;
            if (shouldPause) {
                const pauseTime = randomDelay(100, 500);
                await wait(pauseTime);
            }

            // Add natural mouse movements during typing
            if (Math.random() > 0.7 && (currentTime - lastMouseMoveTime) > 500) {
                const remainingTime = Math.max(0, baseDuration - elapsedTime);
                const movementDuration = Math.min(1000, remainingTime / (text.length - i));
                if (movementDuration > 200) {
                    moveMouseNaturally(page, element, movementDuration);
                    lastMouseMoveTime = Date.now();
                }
            }

            // Adjust typing speed based on remaining time
            const timePerChar = baseDuration / text.length;
            const expectedTime = (i + 1) * timePerChar;
            const actualTime = Date.now() - typingStartTime;

            if (actualTime < expectedTime) {
                await wait(expectedTime - actualTime);
            }
        }
    } catch (error) {
        console.log('Error in humanTypeText:', error.message);
        // Fallback to simple typing if the advanced method fails
        try {
            await element.type(text, { delay: randomDelay(50, 150) });
        } catch (e) {
            console.log('Fallback typing also failed:', e.message);
        }
    }
}

// Function to find and interact with Google search box
async function findAndTypeInSearchBox(page) {
    try {
        // Try different selectors for Google search box
        const searchSelectors = [
            'textarea[name="q"]',
            'input[name="q"]',
            'input[type="text"]',
            'textarea',
            'input'
        ];

        for (const selector of searchSelectors) {
            try {
                const searchBox = await page.$(selector);
                if (searchBox) {
                    // Check if it's likely a search box
                    const box = await searchBox.boundingBox();
                    if (box && box.width > 100) { // Ensure it's a reasonable size
                        return { element: searchBox, selector };
                    }
                }
            } catch (e) {
                continue;
            }
        }
    } catch (error) {
        console.log('Error finding search box:', error.message);
    }
    return null;
}

// Function to simulate form filling with more human-like behavior
async function fillRandomForms(page) {
    // First try to find and use Google search box
    try {
        const searchBox = await findAndTypeInSearchBox(page);
        if (searchBox) {
            const { element: input, selector } = searchBox;

            // Scroll into view
            await input.evaluate(el => el.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'nearest'
            }));

            await wait(randomDelay(300, 800));

            // Click on the search box
            await input.click({ delay: randomDelay(30, 100) });
            await wait(randomDelay(200, 500));

            // Clear any existing text
            await input.click({ clickCount: 3 }); // Select all
            await page.keyboard.press('Backspace');
            await wait(randomDelay(200, 500));

            // Type a search query
            const queries = [
                'web development', 'latest news', 'how to code', 'best practices',
                'technology trends', 'artificial intelligence', 'machine learning',
                'web design', 'programming languages', 'software development'
            ];
            const query = queries[Math.floor(Math.random() * queries.length)];

            console.log(`Typing query: ${query}`);
            await humanTypeText(page, input, query);

            // Don't press Enter automatically after typing in search box
            // Just type and leave the cursor there
            await wait(randomDelay(300, 1000));
            return true;
        }
    } catch (error) {
        console.error('Error interacting with search box:', error);
        // Continue to regular form filling if search box interaction fails
    }

    // Fallback to regular form filling if no search box found
    const focusableSelectors = [
        'input:not([type="hidden"]):not([disabled])',
        'textarea:not([disabled])',
        'select:not([disabled])',
        'button:not([disabled])',
        'a[href]',
        '[tabindex]:not([tabindex="-1"])',
        '[contenteditable]'
    ].join(',');

    // Get all focusable elements
    const focusableElements = await page.$$(focusableSelectors);

    // Filter for input elements we want to fill
    const inputElements = [];
    for (const el of focusableElements) {
        try {
            const tagName = await (await el.getProperty('tagName')).jsonValue();
            const type = await (await el.getProperty('type')).catch(() => ({})) || {};

            if (['INPUT', 'TEXTAREA'].includes(tagName) &&
                !['hidden', 'checkbox', 'radio', 'submit', 'button', 'file'].includes(String(type).toLowerCase())) {
                inputElements.push(el);
            }
        } catch (e) {
            continue;
        }
    }

    if (inputElements.length === 0) return;

    // Limit the number of inputs to fill (1-3)
    const inputsToFill = Math.min(inputElements.length, 1 + Math.floor(Math.random() * 3));
    const shuffledInputs = inputElements.sort(() => 0.5 - Math.random()).slice(0, inputsToFill);

    for (const input of shuffledInputs) {
        try {
            // Scroll the element into view
            await input.evaluate(el => {
                el.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'nearest'
                });
            });

            // Wait a bit after scrolling
            await wait(randomDelay(300, 1000));

            // Get the bounding box of the input
            const box = await input.boundingBox();
            if (!box) continue;

            // Move to a random position within the input
            const x = box.x + box.width * (0.2 + Math.random() * 0.6);
            const y = box.y + box.height * (0.2 + Math.random() * 0.6);

            // Move to the position with human-like movement
            await moveMouse(page, x, y);
            await wait(randomDelay(100, 400));

            // Click with human-like behavior
            await page.mouse.down();
            await wait(randomDelay(30, 100));
            await page.mouse.up();
            await wait(randomDelay(200, 600));

            // Determine what to type based on input type
            const inputType = await input.evaluate(el => el.type || 'text');
            let value = '';

            switch(inputType.toLowerCase()) {
                case 'email':
                    value = `test${Math.floor(100 + Math.random() * 900)}@example.com`;
                    break;
                case 'search':
                    value = ['web development', 'latest news', 'how to code', 'best practices',
                            'technology trends', 'artificial intelligence', 'machine learning',
                            'web design', 'programming languages', 'software development']
                            [Math.floor(Math.random() * 10)];
                    break;
                case 'tel':
                    value = `+1${Math.floor(2000000000 + Math.random() * 8000000000)}`;
                    break;
                case 'number':
                    value = String(Math.floor(1 + Math.random() * 100));
                    break;
                case 'url':
                    value = 'https://example.com';
                    break;
                case 'text':
                default:
                    value = [
                        'Hello, how are you today?',
                        'This is a test message.',
                        'Just checking this out.',
                        'Looking for information about this.',
                        'Can you help me with something?',
                        'I have a question about your service.',
                        'Interested in learning more.',
                        'This looks interesting!',
                        'Testing the input field.',
                        'Please provide more details.'
                    ][Math.floor(Math.random() * 10)];
                    break;
            }

            // Type the value with human-like behavior
            await humanTypeText(page, input, value);

            // Sometimes press Enter or Tab (30% chance)
            if (Math.random() < 0.3) {
                await wait(randomDelay(300, 800));
                await page.keyboard.press(Math.random() > 0.5 ? 'Enter' : 'Tab', {
                    delay: randomDelay(50, 150)
                });
            }

            // Random delay before next action
            await wait(randomDelay(500, 2000));

        } catch (error) {
            console.log('Error interacting with input:', error.message);
            // Continue with next input
        }
    }
}

async function clearGoogleSearch(page){

    // Try to find and click the clear button/icon after typing
    try {
        const clearButtonSelector = 'div[role="button"] > span';
        await page.waitForSelector(clearButtonSelector, { visible: true, timeout: 3000 });

        // Get all matching elements
        const elements = await page.$$(clearButtonSelector);

        if (elements.length === 0) {
            return
        }

        console.log(elements.length)
        for (const el of elements) {
            // Ensure the random element is in the viewport
            const isVisible = await el.isIntersectingViewport();
            if (!isVisible) {
                await el.evaluate(el => el.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'center'
                }));
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Resolve a clickable target: closest role=button container or the element itself
            const btnHandle = await el.evaluateHandle(node => node.closest('div[role="button"]') || node);
            const btn = btnHandle.asElement();
            if (btn) {
                await btn.hover().catch(() => {});
                await btn.click({ delay: 20 });
                console.log('Clicked clear button after typing (random element)');
            } else {
                console.log('Could not resolve clickable element for clear button');
            }
        }
        await wait(randomDelay(500, 1000));

    } catch (clearError) {
        console.log('Could not find or click clear button:', clearError.message);
    }
}

// Weighted action types for more realistic behavior
const ACTION_WEIGHTS = {
    SCROLL: 25,         // Basic scrolling
    WHEEL_SCROLL: 15,   // Precise wheel scrolling
    MOUSE_MOVE: 20,     // Random mouse movements
    TYPING: 25,         // Form filling and typing
    NAVIGATION: 5,      // Tab switching, back/forward
    REFRESH: 5,         // Page refresh
    IDLE: 5             // Short periods of inactivity
};

// Calculate total weight for probability distribution
const TOTAL_WEIGHT = Object.values(ACTION_WEIGHTS).reduce((a, b) => a + b, 0);

// Function to select a weighted random action
function getRandomAction() {
    let random = Math.random() * TOTAL_WEIGHT;
    let weightSum = 0;

    const actions = Object.entries(ACTION_WEIGHTS);
    for (const [action, weight] of actions) {
        weightSum += weight;
        if (random <= weightSum) return action;
    }

    return 'SCROLL'; // Default fallback
}

// Function to simulate tab switching
async function switchTab(page) {
    try {
        // Simulate alt+tab (switch to another application)
        await page.keyboard.down('Alt');
        await page.keyboard.press('Tab');
        await wait(randomDelay(100, 300));
        await page.keyboard.up('Alt');

        // Random delay while "using another application"
        await wait(randomDelay(1000, 5000));

        // Switch back
        await page.keyboard.down('Alt');
        await page.keyboard.press('Tab');
        await wait(randomDelay(100, 300));
        await page.keyboard.up('Alt');

    } catch (error) {
        console.log('Error during tab switch simulation:', error.message);
    }
}

// Function to simulate browsing history navigation
async function navigateHistory(page) {
    try {
        // Randomly decide to go back or forward (70% back, 30% forward)
        const goBack = Math.random() < 0.7;

        if (goBack) {
            await page.goBack({ waitUntil: 'networkidle0' });
        } else {
            await page.goForward({ waitUntil: 'networkidle0' });
        }

        await wait(randomDelay(1000, 3000));
    } catch (error) {
        // If navigation fails (no history), continue with other actions
        console.log('Navigation not possible, continuing...');
    }
}

// Helper function to ensure we're on the correct URL
async function ensureCorrectUrl(page, targetUrl) {
    try {
        const currentUrl = page.url();
        if (currentUrl !== targetUrl) {
            console.log(`Navigating back to target URL: ${targetUrl}`);
            await page.goto(targetUrl, {
                waitUntil: 'networkidle0',
                timeout: 30000
            });
            await wait(randomDelay(2000, 4000));
        }
    } catch (error) {
        console.error('Error ensuring correct URL:', error.message);
    }
}

module.exports = {
    randomScroll,
    randomMouseMovements,
    randomClicks,
    randomWheelScroll,
    randomKeyPresses,
    fillRandomForms,
    clearGoogleSearch,
    getRandomAction,
    switchTab,
    navigateHistory,
    ensureCorrectUrl,
    moveMouse,
    humanTypeText
};
