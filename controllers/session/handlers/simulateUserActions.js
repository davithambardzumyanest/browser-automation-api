const { sessions } = require('../state');
const { wait, randomDelay } = require('../helpers/timing');
const {
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
    ensureCorrectUrl
} = require('../helpers/simulateActionBehaviors');

// Main function to simulate user actions
const simulateUserActions = async (req, res) => {
    const { sessionId } = req.params;
    const { durationMinutes = 5 } = req.body;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessions.get(sessionId);
    const { browser, page } = session;

    if (!browser || !page) {
        return res.status(400).json({ error: 'Browser or page not available' });
    }

    // Store the original URL
    let targetUrl = page.url();
    console.log('Original URL set to:', targetUrl);

    try {
        const endTime = Date.now() + (durationMinutes * 60 * 1000);
        let lastTypingTime = 0;

        // Start the simulation in the background
        (async () => {
            console.log(`Starting user simulation for session ${sessionId} for ${durationMinutes} minutes`);

            // Initial delay to make it seem more natural
            await wait(randomDelay(1000, 3000));

            while (Date.now() < endTime) {
                try {
                    // Ensure we're still on the correct URL before each action
                    await ensureCorrectUrl(page, targetUrl);

                    const action = getRandomAction();

                    switch(action) {
                        case 'SCROLL':
                            await randomScroll(page);
                            break;

                        case 'WHEEL_SCROLL':
                            await randomWheelScroll(page);
                            break;

                        case 'MOUSE_MOVE':
                            await randomMouseMovements(page);
                            // Sometimes click on random elements
                            if (Math.random() < 0.3) {
                                await wait(randomDelay(300, 800));
                                await randomClicks(page);
                            }
                            break;

                        case 'TYPING':
                            // Don't type too often in a short period
                            const now = Date.now();
                            if (now - lastTypingTime > 10000) { // At least 10 seconds between typing sessions
                                try {
                                    // Double check URL before typing
                                    await ensureCorrectUrl(page, targetUrl);

                                    // Try to find and interact with input fields
                                    const success = await fillRandomForms(page);

                                    if (success) {
                                        console.log('Successfully typed in form field');
                                    } else {
                                        console.log('No suitable input field found for typing');
                                    }

                                    lastTypingTime = now;

                                    // Sometimes clear after typing (20% chance)
                                    if (Math.random() < 0.2) {
                                        await clearGoogleSearch(page);
                                    } else if (Math.random() < 0.5) {
                                        await randomKeyPresses(page);
                                    }
                                } catch (error) {
                                    console.error('Error during typing action:', error.message);
                                }
                            }
                            break;

                        case 'NAVIGATION':
                            // Randomly choose between tab switching and history navigation
                            if (Math.random() < 0.7) {
                                await switchTab(page);
                            } else {
                                await navigateHistory(page);
                            }
                            break;

                        case 'REFRESH':
                            if (Math.random() < 0.3) { // 30% chance to actually refresh
                                await page.reload({
                                    waitUntil: ['domcontentloaded', 'networkidle0'],
                                    timeout: 30000
                                });
                                await wait(randomDelay(1000, 5000));
                            }
                            break;

                        case 'IDLE':
                            // Random idle time (simulating reading/thinking)
                            await wait(randomDelay(1000, 5000));
                            break;
                    }

                    // Variable delay between actions (shorter for some actions)
                    const baseDelay = ['TYPING', 'IDLE'].includes(action)
                        ? randomDelay(100, 600)
                        : randomDelay(300, 1000);

                    await wait(baseDelay);

                } catch (error) {
                    console.error('Error during simulation:', error.message);
                    // Continue with the next action after a short delay
                    await wait(randomDelay(1000, 3000));
                }
            }

            console.log(`User simulation completed for session ${sessionId}`);
        })();

        res.json({
            success: true,
            message: `User simulation started for ${durationMinutes} minutes`,
            actions: 'Enhanced human-like behavior with natural mouse movements, typing, and browsing patterns'
        });

    } catch (error) {
        console.error('Error starting user simulation:', error);
        res.status(500).json({
            error: 'Failed to start user simulation',
            details: error.message
        });
    }
};

module.exports = { simulateUserActions };
