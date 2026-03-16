const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { v4: uuidv4 } = require('uuid');

// Add stealth plugin
puppeteer.use(StealthPlugin());

// Session storage
const sessions = new Map();

// Session cleanup interval (check every minute)
const CLEANUP_INTERVAL = 60000; // 1 minute
const SESSION_TIMEOUT = 3600000; // 60 minutes (1 hour)

// Browser launch arguments
const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-web-security',
    '--disable-infobars',
    '--window-size=1920,1080',
    '--start-maximized',
    '--disable-notifications',
    '--disable-popup-blocking',
    '--disable-translate',
    '--disable-extensions',
    '--disable-extensions-except',
    '--disable-extensions-file-access-check',
    '--disable-component-extensions-with-background-pages',
    '--disable-default-apps',
    '--mute-audio',
    '--safebrowsing-disable-auto-update',
    '--disable-sync',
    '--metrics-recording-only',
    '--disable-hang-monitor',
    '--disable-prompt-on-repost',
    '--disable-client-side-phishing-detection',
    '--password-store=basic',
    '--use-mock-keychain',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-back-forward-cache-for-cache-control-no-store',
    '--disable-back-forward-cache',
    '--disable-breakpad',
    '--disable-ipc-flooding-protection',
    '--disable-session-crashed-bubble',
    '--force-color-profile=srgb',
    '--no-default-browser-check',
    '--no-service-autorun',
    '--deny-permission-prompts',
    '--disable-search-geolocation-disclosure',
    '--disable-features=site-per-process',
    '--disable-blink-features',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-features=MediaSource',
    '--disable-blink-features=AutomationControlled',
];

// Common user agents for rotation
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/118.0'
];

// Function to get a random user agent
const getRandomUserAgent = () => {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
};

// Helper function to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Session cleanup worker
const startCleanupWorker = () => {
    setInterval(async () => {
        const now = Date.now();
        const sessionsToDelete = [];

        for (const [sessionId, session] of sessions.entries()) {
            if (now - session.lastUsed > SESSION_TIMEOUT) {
                console.log(`Cleaning up inactive session: ${sessionId}`);
                sessionsToDelete.push(sessionId);
            }
        }

        for (const sessionId of sessionsToDelete) {
            await closeSession(sessionId);
        }
    }, CLEANUP_INTERVAL);
};

/**
 * API endpoint to solve reCAPTCHA on current page
 */

/**
 * API endpoint to solve reCAPTCHA on current page
 */

/**
 * Configure 2Captcha extension using Chrome extension APIs
 * @param {Object} page - Puppeteer page object
 * @param {Object} options - Configuration options
 * @param {string} options.apiKey - 2Captcha API key
 * @param {Object} options.proxy - Proxy configuration
 * @param {string} options.proxy.username - Proxy username
 * @param {string} options.proxy.password - Proxy password
 * @param {string} options.proxy.server - Proxy server URL
 * @param {string} options.proxy.type - Proxy type (HTTP, HTTPS, SOCKS4, SOCKS5)
 * @param {boolean} options.useProxy - Whether to use proxy
 * @param {string} options.proxyType - Proxy type
 * @param {string} options.extId - String type
 */
const configure2CaptchaDirectly = async (page, options = {}) => {
    const proxy = options.proxy;

    return await page.evaluate((cfg, extId) => {
        return new Promise(resolve => {
            chrome.runtime.sendMessage(
                extId,
                { type: 'SET_CONFIG', config: cfg },
                res => resolve(res)
            );
        });
    }, {
        apiKey: process.env.TWO_CAPTCHA_API_KEY,
        isPluginEnabled: true,
        recaptcha: {
            enabled: true,
            autoSolveV2: true,
            autoSolveInvisibleV2: true
        },

        repeatOnErrorTimes: 2,
        repeatOnErrorDelay: 1000,
        useProxy: true,
        proxy: proxy && proxy.username && proxy.password && proxy.server
            ? `${proxy.username}:${proxy.password}@${proxy.server.replace(/^https?:\/\//, '')}`
            : "",
    }, options.extId);
};


/**
 * Legacy function for backward compatibility - now uses direct configuration
 * @param {Object} page - Puppeteer page object
 * @param {Object} proxy - Proxy configuration
 */
const login2Captcha = async (page, proxy) => {
    console.log('Using legacy login2Captcha function - redirecting to direct configuration');
    
    const success = await configure2CaptchaDirectly(page, {
        apiKey: process.env.TWO_CAPTCHA_API_KEY,
        proxy: proxy,
        useProxy: proxy && proxy.username && proxy.password,
        proxyType: proxy?.type || 'HTTP'
    });

    if (success) {
        console.log('2Captcha configured successfully via direct method');
    } else {
        console.error('Failed to configure 2Captcha');
    }

    return success;
};

/**
 * Validate 2Captcha extension configuration
 * @param {Object} page - Puppeteer page object
 * @returns {Promise<Object>} Configuration status
 */
const validate2CaptchaConfig = async (page) => {
    try {
        const config = await page.evaluate(() => {
            return new Promise((resolve) => {
                chrome.storage.local.get('config', (result) => {
                    resolve(result.config || {});
                });
            });
        });

        return {
            configured: !!config.apiKey,
            apiKeySet: !!config.apiKey,
            proxyEnabled: config.useProxy,
            proxySet: !!config.proxy,
            extensionEnabled: config.isPluginEnabled,
            config: config
        };
    } catch (error) {
        console.error('Failed to validate 2Captcha config:', error);
        return {
            configured: false,
            error: error.message
        };
    }
};

const solveRecaptchaEndpoint = async (req, res) => {
    const { sessionId } = req.params;
    const { submitAfter = false, waitTime = 5000 } = req.body;

    const session = sessions.get(sessionId);

    if (!session) {
        return res.status(404).json({
            error: "Session not found"
        });
    }

    const page = session.page;

    try {
        console.log("🚀 Starting captcha solving");
        
        // Debug: Check if proxy is available in session
        console.log("🔐 Session proxy:", session.proxy);
        console.log("🔐 Session config proxy:", session.config?.proxy_full);
        const sessionProxy = session.config?.proxy_full || null;
        console.log("🔐 Using proxy:", sessionProxy);

        // Forward browser console logs to node
        page.on("console", msg => console.log("BROWSER:", msg.text()));

        // 1️⃣ Detect reCAPTCHA sitekey and s parameter
        const captchaInfo = await page.evaluate(() => {
            const result = {
                siteKey: null,
                isEnterprise: false,
                s: null // Capture the 's' parameter if available
            };

            const iframe = document.querySelector('iframe[src*="recaptcha"]');

            if (iframe) {
                const match = iframe.src.match(/[?&]k=([^&]+)/);
                if (match) result.siteKey = match[1];

                if (iframe.src.includes("enterprise")) {
                    result.isEnterprise = true;
                    const sMatch = iframe.src.match(/[?&]s=([^&]+)/);
                    if (sMatch) {
                        result.s = sMatch[1];  // Capture the 's' parameter
                        console.log("🔑 Found enterprise reCAPTCHA, s parameter:", result.s); // Log s parameter
                    }
                }
            }

            if (!result.siteKey && window.___grecaptcha_cfg) {
                const clients = window.___grecaptcha_cfg.clients || {};
                for (const client of Object.values(clients)) {
                    for (const key of Object.keys(client)) {
                        const obj = client[key];
                        if (obj && obj.sitekey) {
                            result.siteKey = obj.sitekey;
                            if (obj.enterprise) {
                                result.isEnterprise = true;
                                if (obj.s) result.s = obj.s; // Capture 's' from client if available
                                console.log("🔑 Found enterprise reCAPTCHA in grecaptcha_cfg, s parameter:", result.s); // Log s parameter
                            }
                            break;
                        }
                    }
                }
            }

            return result;
        });

        if (!captchaInfo.siteKey) {
            return res.status(400).json({
                success: false,
                message: "No reCAPTCHA detected"
            });
        }

        console.log("🎫 Sitekey:", captchaInfo.siteKey);
        console.log("Enterprise:", captchaInfo.isEnterprise);
        console.log("🔑 s Parameter:", captchaInfo.s); // Log the captured 's' parameter

        // -------------------------------------------------
        // 2️⃣ Solve captcha with 2Captcha
        // -------------------------------------------------

        const token = await solveRecaptchaWith2Captcha(
            page,
            captchaInfo.siteKey,
            page.url(),
            sessionProxy,
            captchaInfo.isEnterprise,
            captchaInfo.s // Pass 's' if available
        );

        console.log("🎯 Captcha solved");

        // -------------------------------------------------
        // 3️⃣ Inject token and simulate local solving
        // -------------------------------------------------
        
        // First, simulate user interaction with reCAPTCHA before solving
        console.log('🎭 Simulating user interaction with reCAPTCHA...');
        await page.evaluate(() => {
            // Find reCAPTCHA iframe
            const recaptchaIframe = document.querySelector('iframe[src*="recaptcha"]');
            if (recaptchaIframe) {
                const rect = recaptchaIframe.getBoundingClientRect();
                
                // Simulate mouse movements around the reCAPTCHA
                for (let i = 0; i < 5; i++) {
                    setTimeout(() => {
                        const x = rect.left + Math.random() * rect.width;
                        const y = rect.top + Math.random() * rect.height;
                        recaptchaIframe.dispatchEvent(new MouseEvent('mousemove', {
                            bubbles: true,
                            clientX: x,
                            clientY: y
                        }));
                    }, i * 200);
                }
                
                // Simulate hover
                setTimeout(() => {
                    recaptchaIframe.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                    recaptchaIframe.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                }, 1000);
                
                // Simulate click
                setTimeout(() => {
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;
                    
                    recaptchaIframe.dispatchEvent(new MouseEvent('mousedown', {
                        bubbles: true,
                        clientX: centerX,
                        clientY: centerY,
                        button: 0
                    }));
                    
                    setTimeout(() => {
                        recaptchaIframe.dispatchEvent(new MouseEvent('mouseup', {
                            bubbles: true,
                            clientX: centerX,
                            clientY: centerY,
                            button: 0
                        }));
                        
                        recaptchaIframe.dispatchEvent(new MouseEvent('click', {
                            bubbles: true,
                            clientX: centerX,
                            clientY: centerY,
                            button: 0
                        }));
                    }, 100);
                }, 1200);
            }
            
            // Add random clicks to text elements and other areas
            setTimeout(() => {
                const clickableElements = [
                    // Text elements
                    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                    'p', 'span', 'div', 'label', 'strong', 'em',
                    // Links
                    'a',
                    // Form elements
                    'input[type="text"]', 'input[type="email"]', 'input[type="password"]',
                    'textarea', 'select',
                    // Other interactive elements
                    '[role="button"]', '[role="link"]', '[role="option"]'
                ];
                
                const elements = [];
                clickableElements.forEach(selector => {
                    const found = document.querySelectorAll(selector);
                    elements.push(...Array.from(found));
                });
                
                // Filter out buttons and reCAPTCHA elements
                const filteredElements = elements.filter(el => {
                    const tagName = el.tagName.toLowerCase();
                    const isButton = tagName === 'button' || el.type === 'submit' || el.type === 'button';
                    const isRecaptcha = el.src && el.src.includes('recaptcha') || 
                                     el.id && el.id.includes('recaptcha');
                    const isVisible = el.offsetParent !== null && 
                                    el.offsetWidth > 0 && 
                                    el.offsetHeight > 0;
                    return !isButton && !isRecaptcha && isVisible;
                });
                
                // Click 3-7 random elements
                const numClicks = Math.floor(Math.random() * 5) + 3;
                const selectedElements = [];
                
                for (let i = 0; i < numClicks && filteredElements.length > 0; i++) {
                    const randomIndex = Math.floor(Math.random() * filteredElements.length);
                    const element = filteredElements[randomIndex];
                    
                    if (!selectedElements.includes(element)) {
                        selectedElements.push(element);
                        
                        const rect = element.getBoundingClientRect();
                        const x = rect.left + Math.random() * rect.width;
                        const y = rect.top + Math.random() * rect.height;
                        
                        setTimeout(() => {
                            // Mouse approach
                            element.dispatchEvent(new MouseEvent('mousemove', {
                                bubbles: true,
                                clientX: x,
                                clientY: y
                            }));
                            
                            setTimeout(() => {
                                // Hover
                                element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                                element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                                
                                setTimeout(() => {
                                    // Click sequence
                                    element.dispatchEvent(new MouseEvent('mousedown', {
                                        bubbles: true,
                                        clientX: x,
                                        clientY: y,
                                        button: 0,
                                        detail: 1
                                    }));
                                    
                                    setTimeout(() => {
                                        element.dispatchEvent(new MouseEvent('mouseup', {
                                            bubbles: true,
                                            clientX: x,
                                            clientY: y,
                                            button: 0,
                                            detail: 1
                                        }));
                                        
                                        element.dispatchEvent(new MouseEvent('click', {
                                            bubbles: true,
                                            clientX: x,
                                            clientY: y,
                                            button: 0,
                                            detail: 1
                                        }));
                                        
                                        // Sometimes add a double click
                                        if (Math.random() < 0.3) { // 30% chance
                                            setTimeout(() => {
                                                element.dispatchEvent(new MouseEvent('dblclick', {
                                                    bubbles: true,
                                                    clientX: x,
                                                    clientY: y,
                                                    button: 0,
                                                    detail: 2
                                                }));
                                            }, 100);
                                        }
                                        
                                        // Move away after click
                                        setTimeout(() => {
                                            element.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
                                            element.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
                                        }, 50);
                                    }, 80 + Math.random() * 40); // 80-120ms
                                }, 50);
                            }, 30);
                        }, i * 800 + Math.random() * 400); // Staggered timing
                    }
                }
                
                console.log(`🎭 Added ${selectedElements.length} random clicks to text elements`);
            }, 2000); // Start random clicks after reCAPTCHA interaction
        });
        
        // Wait for interaction simulation
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Now inject token with advanced local solving simulation
        console.log('💉 Injecting token with advanced local solving simulation...');
        await page.evaluate((token) => {
            console.log("🎭 Starting advanced local solving simulation");
            
            // Record solving start time and create solving context
            window.__recaptchaSolveStart = Date.now();
            window.__recaptchaLocalSolving = true;
            window.__recaptchaSolvingSteps = [];
            
            // Create realistic solving timeline
            const solveSteps = {
                initialFocus: 200 + Math.random() * 300,      // 200-500ms
                iframeInteraction: 800 + Math.random() * 400,   // 800-1200ms
                challengeAppear: 1200 + Math.random() * 800,   // 1200-2000ms
                userThinking: 2000 + Math.random() * 1000,  // 2000-3000ms
                startSolving: 3500 + Math.random() * 1500,  // 3500-5000ms
                solvingProcess: 8000 + Math.random() * 12000, // 8000-20000ms
                verification: 2000 + Math.random() * 1000       // 2000-3000ms
            };
            
            // Step 1: Initial page focus and scroll
            setTimeout(() => {
                window.focus();
                window.scrollTo(0, document.body.scrollHeight / 2);
                window.__recaptchaSolvingSteps.push('page_focused_and_scrolled');
            }, solveSteps.initialFocus);
            
            // Step 2: Find and interact with reCAPTCHA iframe
            setTimeout(() => {
                const recaptchaIframe = document.querySelector('iframe[src*="recaptcha"]');
                if (recaptchaIframe) {
                    const rect = recaptchaIframe.getBoundingClientRect();
                    
                    // Simulate realistic mouse approach
                    const approachPoints = [
                        { x: rect.left - 50, y: rect.top - 20 },
                        { x: rect.left + 20, y: rect.top + 10 },
                        { x: rect.left + rect.width / 2, y: rect.top - 10 }
                    ];
                    
                    approachPoints.forEach((point, index) => {
                        setTimeout(() => {
                            recaptchaIframe.dispatchEvent(new MouseEvent('mousemove', {
                                bubbles: true,
                                clientX: point.x,
                                clientY: point.y
                            }));
                        }, index * 150);
                    });
                    
                    // Hover over reCAPTCHA
                    setTimeout(() => {
                        recaptchaIframe.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                        recaptchaIframe.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                        window.__recaptchaSolvingSteps.push('iframe_hovered');
                    }, 600);
                }
            }, solveSteps.iframeInteraction);
            
            // Step 3: Wait for challenge to appear and click
            setTimeout(() => {
                const recaptchaIframe = document.querySelector('iframe[src*="recaptcha"]');
                if (recaptchaIframe) {
                    const rect = recaptchaIframe.getBoundingClientRect();
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;
                    
                    // Realistic click sequence with pressure variations
                    setTimeout(() => {
                        recaptchaIframe.dispatchEvent(new MouseEvent('mousedown', {
                            bubbles: true,
                            clientX: centerX + (Math.random() - 0.5) * 2,
                            clientY: centerY + (Math.random() - 0.5) * 2,
                            button: 0,
                            pressure: 0.7 + Math.random() * 0.3
                        }));
                    }, 200);
                    
                    setTimeout(() => {
                        recaptchaIframe.dispatchEvent(new MouseEvent('mouseup', {
                            bubbles: true,
                            clientX: centerX + (Math.random() - 0.5) * 2,
                            clientY: centerY + (Math.random() - 0.5) * 2,
                            button: 0,
                            pressure: 0.3 + Math.random() * 0.4
                        }));
                    }, 350);
                    
                    setTimeout(() => {
                        recaptchaIframe.dispatchEvent(new MouseEvent('click', {
                            bubbles: true,
                            clientX: centerX,
                            clientY: centerY,
                            button: 0,
                            detail: 1
                        }));
                        window.__recaptchaSolvingSteps.push('iframe_clicked');
                    }, 400);
                }
            }, solveSteps.challengeAppear);
            
            // Step 4: User thinking time before solving
            setTimeout(() => {
                // Simulate user reading and understanding the challenge
                window.__recaptchaSolvingSteps.push('user_thinking');
                
                // Add some random mouse movements during thinking
                for (let i = 0; i < 3; i++) {
                    setTimeout(() => {
                        document.dispatchEvent(new MouseEvent('mousemove', {
                            bubbles: true,
                            clientX: Math.random() * window.innerWidth,
                            clientY: Math.random() * window.innerHeight
                        }));
                    }, i * 300);
                }
            }, solveSteps.userThinking);
            
            // Step 5: Start solving process
            setTimeout(() => {
                window.__recaptchaSolvingSteps.push('solving_started');
                
                // Find and prepare textarea
                let textarea = document.getElementById("g-recaptcha-response");
                if (!textarea) {
                    textarea = document.createElement("textarea");
                    textarea.id = "g-recaptcha-response";
                    textarea.name = "g-recaptcha-response";
                    textarea.style.display = "none";
                    document.body.appendChild(textarea);
                    window.__recaptchaSolvingSteps.push('textarea_created');
                }
                
                // Simulate realistic typing with variations
                let currentValue = '';
                const baseTypingSpeed = 70 + Math.random() * 50; // 70-120ms base
                const typingVariations = [0.8, 1.2, 0.9, 1.1, 1.0]; // Speed variations
                
                const typeCharacter = (index) => {
                    if (index < token.length) {
                        currentValue += token[index];
                        textarea.value = currentValue;
                        
                        const currentSpeed = baseTypingSpeed * (typingVariations[index % typingVariations.length]);
                        
                        // Comprehensive keyboard events
                        const keyEvents = [
                            new KeyboardEvent('keydown', {
                                bubbles: true,
                                key: token[index],
                                code: `Key${token[index].toUpperCase()}`,
                                keyCode: token.charCodeAt(index),
                                charCode: token.charCodeAt(index),
                                which: token.charCodeAt(index),
                                location: 0,
                                altKey: false,
                                ctrlKey: false,
                                shiftKey: false,
                                metaKey: false
                            }),
                            new Event('input', { bubbles: true }),
                            new KeyboardEvent('keyup', {
                                bubbles: true,
                                key: token[index],
                                code: `Key${token[index].toUpperCase()}`,
                                keyCode: token.charCodeAt(index),
                                charCode: token.charCodeAt(index),
                                which: token.charCodeAt(index),
                                location: 0,
                                altKey: false,
                                ctrlKey: false,
                                shiftKey: false,
                                metaKey: false
                            })
                        ];
                        
                        // Dispatch events with realistic timing
                        keyEvents.forEach((event, eventIndex) => {
                            setTimeout(() => {
                                textarea.dispatchEvent(event);
                            }, eventIndex * 5);
                        });
                        
                        window.__recaptchaSolvingSteps.push(`typed_char_${index}_${currentSpeed.toFixed(0)}ms`);
                        
                        // Add occasional pauses and corrections
                        if (Math.random() < 0.1 && index > 0) { // 10% chance of pause
                            setTimeout(() => {
                                // Simulate backspace and correction
                                textarea.dispatchEvent(new KeyboardEvent('keydown', {
                                    bubbles: true,
                                    key: 'Backspace',
                                    keyCode: 8,
                                    which: 8
                                }));
                                
                                currentValue = currentValue.slice(0, -1);
                                textarea.value = currentValue;
                                
                                setTimeout(() => {
                                    typeCharacter(index); // Retry same character
                                }, 150);
                            }, currentSpeed);
                        } else {
                            setTimeout(() => typeCharacter(index + 1), currentSpeed);
                        }
                    } else {
                        // Token fully typed - completion sequence
                        setTimeout(() => {
                            textarea.dispatchEvent(new Event('change', { bubbles: true }));
                            textarea.dispatchEvent(new Event('blur', { bubbles: true }));
                            window.__recaptchaSolvingSteps.push('token_completed');
                            
                            // Store token and completion data
                            window.__captchaToken = token;
                            window.__recaptchaSolveEnd = Date.now();
                            window.__recaptchaSolveTime = window.__recaptchaSolveEnd - window.__recaptchaSolveStart;
                            
                            // Final verification events
                            const completionEvents = [
                                new Event('change', { bubbles: true }),
                                new Event('input', { bubbles: true }),
                                new CustomEvent('recaptcha.success', { bubbles: true, detail: { token } }),
                                new CustomEvent('captcha.completed', { bubbles: true, detail: { 
                                    token, 
                                    solveTime: window.__recaptchaSolveTime,
                                    steps: window.__recaptchaSolvingSteps 
                                }})
                            ];
                            
                            completionEvents.forEach((event, index) => {
                                setTimeout(() => {
                                    textarea.dispatchEvent(event);
                                    document.dispatchEvent(event);
                                }, index * 100);
                            });
                            
                            console.log('🎭 Advanced local solving completed in', window.__recaptchaSolveTime, 'ms');
                            console.log('🎭 Total solving steps:', window.__recaptchaSolvingSteps.length);
                            console.log('🎭 Solving timeline:', solveSteps);
                            
                        }, 500);
                    }
                };
                
                // Start typing with initial delay
                setTimeout(() => typeCharacter(0), 300 + Math.random() * 200);
                
            }, solveSteps.startSolving);
            
        }, token);
        
        // Wait for advanced simulation to complete
        await new Promise(resolve => setTimeout(resolve, 25000)); // Wait 25 seconds for full simulation

        // -------------------------------------------------
        // 4️⃣ Trigger grecaptcha execution
        // -------------------------------------------------
        await page.evaluate(() => {
            if (!window.grecaptcha) return;

            console.log("⚡ Triggering grecaptcha");

            try {
                if (window.grecaptcha.enterprise?.execute) {
                    window.grecaptcha.enterprise.execute();
                }

                if (window.grecaptcha.execute) {
                    window.grecaptcha.execute();
                }

            } catch (e) {
                console.log("execute error", e);
            }

        }, token);

        // -------------------------------------------------
        // 5️⃣ Trigger internal callbacks with safe recursion
        // -------------------------------------------------
        await page.evaluate((token) => {
            console.log("🔔 Triggering callbacks");

            // Use a Set to track visited objects and avoid infinite recursion
            const visited = new Set();

            function searchCallbacks(obj) {
                if (!obj || typeof obj !== "object") return;

                // If we've already visited this object, avoid recursion
                if (visited.has(obj)) return;
                visited.add(obj);

                for (const key in obj) {
                    const val = obj[key];

                    if (key === "callback" && typeof val === "function") {
                        try {
                            console.log("Calling callback");
                            val(token);
                        } catch (e) {
                            console.log("callback error", e);
                        }
                    }

                    if (typeof val === "object") {
                        searchCallbacks(val);
                    }
                }
            }

            if (window.___grecaptcha_cfg?.clients) {
                Object.values(window.___grecaptcha_cfg.clients).forEach(client => searchCallbacks(client));
            }

        }, token);

        // -------------------------------------------------
        // 6️⃣ Fire generic success events
        // -------------------------------------------------
        await page.evaluate(() => {
            const events = [
                "captcha-success",
                "recaptcha-success",
                "verification-complete"
            ];

            events.forEach(name => {
                document.dispatchEvent(new Event(name, { bubbles: true }));
            });

        });

        // -------------------------------------------------
        // 7️⃣ Wait for page logic
        // -------------------------------------------------
        await new Promise(r => setTimeout(r, waitTime));

        // -------------------------------------------------
        // 8️⃣ Optional submit
        // -------------------------------------------------

        let submitResult = null;
        if (submitAfter) {
            submitResult = await page.evaluate(() => {
                const buttons = document.querySelectorAll("button, input[type=submit]");
                for (const btn of buttons) {
                    if (!btn.disabled && btn.offsetParent !== null) {
                        btn.click();
                        return { success: true, text: btn.innerText || btn.value };
                    }
                }
                return { success: false };
            });
        }

        return res.json({
            success: true,
            tokenPreview: token.substring(0, 30) + "...",
            submitted: submitAfter,
            submitResult
        });

    } catch (error) {
        console.error("Captcha solving error:", error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};
/**
 * API endpoint to configure 2Captcha extension
 */
const configure2CaptchaEndpoint = async (req, res) => {
    const { sessionId } = req.params;
    const { apiKey, proxy, useProxy, proxyType = 'HTTP' } = req.body;

    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    try {
        const success = await configure2CaptchaDirectly(session.page, {
            apiKey: apiKey || process.env.TWO_CAPTCHA_API_KEY,
            proxy: proxy,
            useProxy: useProxy,
            proxyType: proxyType
        });

        if (success) {
            const validation = await validate2CaptchaConfig(session.page);
            res.json({
                success: true,
                message: '2Captcha configured successfully',
                configuration: validation
            });
        } else {
            res.status(500).json({
                error: 'Failed to configure 2Captcha',
                message: 'Extension may not be loaded or configuration failed'
            });
        }
    } catch (error) {
        console.error('Error configuring 2Captcha:', error);
        res.status(500).json({
            error: 'Failed to configure 2Captcha',
            message: error.message
        });
    }
};

/**
 * Enhanced diagnostic function to check for recaptcha errors
 * @param {Object} page - Puppeteer page object
 * @returns {Promise<Object>} Diagnostic results
 */
const diagnose2Captcha = async (page) => {
    console.log('🔍 Diagnosing 2Captcha extension...');
    
    const diagnostics = {
        extensionLoaded: false,
        configAccessible: false,
        apiKeySet: false,
        proxyEnabled: false,
        errors: [],
        recaptchaObjectFound: false,
        configObjectFound: false
    };

    try {
        // Check if extension is loaded by trying to access its options page
        try {
            await page.goto('chrome-extension://kdkekakoakfeklbmhphehpbbcpnlaocn/options/options.html', {
                waitUntil: 'domcontentloaded',
                timeout: 5000
            });
            diagnostics.extensionLoaded = true;
            console.log('✅ Extension options page accessible');
        } catch (err) {
            diagnostics.errors.push(`Extension not accessible: ${err.message}`);
            console.log('❌ Extension options page not accessible');
        }

        if (diagnostics.extensionLoaded) {
            // Check for recaptcha object and other global objects
            try {
                const globalCheck = await page.evaluate(() => {
                    const results = {
                        configObjectFound: typeof Config !== 'undefined',
                        recaptchaObjectFound: typeof recaptcha !== 'undefined',
                        grecaptchaObjectFound: typeof grecaptcha !== 'undefined',
                        chromeStorageAvailable: typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local,
                        chromeRuntimeAvailable: typeof chrome !== 'undefined' && chrome.runtime,
                        windowConfig: window.config || null,
                        documentRecaptcha: !!document.querySelector('[data-sitekey], .g-recaptcha, #recaptcha')
                    };
                    
                    // Try to get current config
                    if (typeof Config !== 'undefined') {
                        try {
                            results.currentConfig = Config.default || {};
                            results.apiKeySet = !!(results.currentConfig.apiKey);
                            results.useProxy = results.currentConfig.useProxy || false;
                        } catch (configErr) {
                            results.configError = configErr.message;
                        }
                    }
                    
                    return results;
                });

                diagnostics.configObjectFound = globalCheck.configObjectFound;
                diagnostics.recaptchaObjectFound = globalCheck.recaptchaObjectFound;
                diagnostics.grecaptchaObjectFound = globalCheck.grecaptchaObjectFound;
                diagnostics.chromeStorageAvailable = globalCheck.chromeStorageAvailable;
                diagnostics.chromeRuntimeAvailable = globalCheck.chromeRuntimeAvailable;
                diagnostics.documentRecaptcha = globalCheck.documentRecaptcha;
                
                if (globalCheck.configError) {
                    diagnostics.errors.push(`Config object error: ${globalCheck.configError}`);
                }
                
                if (globalCheck.currentConfig) {
                    diagnostics.apiKeySet = globalCheck.currentConfig.apiKeySet;
                    diagnostics.proxyEnabled = globalCheck.currentConfig.useProxy;
                }

                console.log('📋 Global objects check:', {
                    configObjectFound: globalCheck.configObjectFound,
                    recaptchaObjectFound: globalCheck.recaptchaObjectFound,
                    grecaptchaObjectFound: globalCheck.grecaptchaObjectFound,
                    chromeStorageAvailable: globalCheck.chromeStorageAvailable,
                    chromeRuntimeAvailable: globalCheck.chromeRuntimeAvailable
                });

                if (globalCheck.configObjectFound) {
                    console.log('✅ Configuration system accessible');
                    diagnostics.configAccessible = true;
                } else {
                    diagnostics.errors.push('Config object not found');
                    console.log('❌ Configuration system not accessible');
                }

                // Check for recaptcha-specific issues
                if (!globalCheck.recaptchaObjectFound && !globalCheck.grecaptchaObjectFound && globalCheck.documentRecaptcha) {
                    diagnostics.errors.push('No recaptcha objects found on page - extension may not be active');
                }

            } catch (err) {
                diagnostics.errors.push(`Global check failed: ${err.message}`);
                console.log('❌ Global check failed');
            }

            // Try to read current stored configuration
            try {
                const storedConfig = await page.evaluate(() => {
                    return new Promise((resolve) => {
                        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                            chrome.storage.local.get('config', (result) => {
                                if (chrome.runtime.lastError) {
                                    resolve({ error: chrome.runtime.lastError.message });
                                } else {
                                    resolve(result.config || {});
                                }
                            });
                        } else {
                            resolve({ error: 'Chrome storage not available' });
                        }
                    });
                });

                if (!storedConfig.error) {
                    console.log('📦 Stored configuration found:', {
                        apiKey: storedConfig.apiKey ? '***SET***' : 'NOT_SET',
                        useProxy: storedConfig.useProxy,
                        proxySet: !!storedConfig.proxy,
                        enabledForRecaptchaV2: storedConfig.enabledForRecaptchaV2,
                        autoSolveRecaptchaV2: storedConfig.autoSolveRecaptchaV2
                    });
                } else {
                    diagnostics.errors.push(`Stored config error: ${storedConfig.error}`);
                }
            } catch (err) {
                diagnostics.errors.push(`Stored config check failed: ${err.message}`);
            }
        }

        // Check extension's background script status
        try {
            const bgStatus = await page.evaluate(() => {
                return new Promise((resolve) => {
                    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getBackgroundPage) {
                        chrome.runtime.getBackgroundPage((bgPage) => {
                            if (chrome.runtime.lastError) {
                                resolve({ error: chrome.runtime.lastError.message });
                            } else {
                                resolve({ 
                                    backgroundPageAccessible: !!bgPage,
                                    apiInitialized: bgPage && typeof bgPage.API !== 'undefined',
                                    hasTwoCaptchaAPI: bgPage && bgPage.API && typeof bgPage.API.solve !== 'undefined'
                                });
                            }
                        });
                    } else {
                        resolve({ error: 'Runtime API not available' });
                    }
                });
            });

            if (!bgStatus.error) {
                console.log('🔧 Background script status:', bgStatus);
                if (bgStatus.hasTwoCaptchaAPI) {
                    console.log('✅ 2Captcha API initialized in background script');
                }
            } else {
                diagnostics.errors.push(`Background script error: ${bgStatus.error}`);
            }
        } catch (err) {
            diagnostics.errors.push(`Background script check failed: ${err.message}`);
        }

    } catch (err) {
        diagnostics.errors.push(`General diagnosis error: ${err.message}`);
    }

    return diagnostics;
};

/**
 * Solve reCAPTCHA using 2Captcha API with proxy support
 * @param {Object} page - Puppeteer page object
 * @param {string} siteKey - The reCAPTCHA site key
 * @param {string} pageUrl - The URL of the page with reCAPTCHA
 * @param {Object} proxy - Proxy configuration (optional)
 * @returns {Promise<string>} The solved reCAPTCHA token
 */
const solveRecaptchaWith2Captcha = async (page, siteKey, pageUrl, proxy = null, s = null) => {
    const API_KEY = process.env.TWO_CAPTCHA_API_KEY;
    
    if (!API_KEY) {
        throw new Error('TWO_CAPTCHA_API_KEY environment variable is not set');
    }

    try {
        console.log('🔍 Sending reCAPTCHA to 2Captcha service...');
        console.log(`📋 Site Key: ${siteKey}`);
        console.log(`📋 Page URL: ${pageUrl}`);
        console.log(`🔑 s Parameter: ${s}`);
        console.log(proxy)

        // Get browser fingerprint for Google with enhanced anti-detection
        const browserInfo = await page.evaluate(() => {
            // Enhanced fingerprinting for Google anti-detection
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillText('Browser fingerprint', 2, 2);
            
            const webgl = document.createElement('canvas');
            const gl = webgl.getContext('webgl') || webgl.getContext('experimental-webgl');
            const debugInfo = gl ? gl.getExtension('WEBGL_debug_renderer_info') : null;
            
            return {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                language: navigator.language,
                languages: navigator.languages,
                screenResolution: `${screen.width}x${screen.height}`,
                colorDepth: screen.colorDepth,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                timezoneOffset: new Date().getTimezoneOffset(),
                webdriver: navigator.webdriver,
                chrome: !!window.chrome,
                chromeRuntime: !!window.chrome?.runtime,
                plugins: Array.from(navigator.plugins).map(p => ({
                    name: p.name,
                    description: p.description,
                    filename: p.filename
                })).slice(0, 5),
                canvas: !!canvas.getContext,
                canvasFingerprint: canvas.toDataURL().slice(-50), // Last 50 chars
                webgl: !!gl,
                webglVendor: gl ? gl.getParameter(gl.VENDOR) : null,
                webglRenderer: gl ? gl.getParameter(gl.RENDERER) : null,
                cookies: navigator.cookieEnabled,
                dnt: navigator.doNotTrack,
                onLine: navigator.onLine,
                connection: navigator.connection ? {
                    effectiveType: navigator.connection.effectiveType,
                    downlink: navigator.connection.downlink,
                    rtt: navigator.connection.rtt
                } : null,
                deviceMemory: navigator.deviceMemory || 0,
                hardwareConcurrency: navigator.hardwareConcurrency || 1,
                permissions: navigator.permissions ? Object.keys(navigator.permissions) : [],
                // Google-specific properties
                googleAccount: !!window.google?.accounts,
                gapi: !!window.gapi,
                recaptcha: !!window.grecaptcha,
                // Anti-automation detection
                automation: {
                    hasPhantom: !!window.callPhantom,
                    hasSelenium: !!window._selenium,
                    hasWebDriver: !!navigator.webdriver,
                    hasChromeDriver: !!window.chrome?.runtime?.onConnect
                }
            };
        });

        console.log('🖥️ Enhanced browser fingerprint:', browserInfo);

        // Prepare 2Captcha API parameters with exact values
        const apiParams = {
            key: API_KEY,
            method: 'userrecaptcha',
            googlekey: siteKey,
            pageurl: pageUrl,
            invisible: 0,
            enterprise: 1,
            version: 'v2',
            action: 'signin',
            soft_id: 2834,
            header_acao: 1,
            json: 1
        };

        // Add proxy parameters if proxy is available
        if (proxy) {
            let proxyString = '';
            let proxyType = 'HTTP'; // Default proxy type
            
            if (typeof proxy === 'string') {
                // Simple proxy string: "http://host:port" or "host:port"
                proxyString = proxy.startsWith('http') ? proxy.replace(/^https?:\/\//, '') : proxy;
            } else if (typeof proxy === 'object') {
                // Proxy object with server, username, password, type
                if (proxy.server) {
                    proxyString = proxy.server.replace(/^https?:\/\//, '');
                    
                    // Add authentication if provided
                    if (proxy.username && proxy.password) {
                        proxyString = `${proxy.username}:${proxy.password}@${proxyString}`;
                    }
                }
                proxyType = proxy.type || proxyType;
            }
            
            if (proxyString) {
                apiParams.proxy = proxyString;
                apiParams.proxytype = proxyType.toUpperCase();
                console.log(`🔐 Added proxy: ${proxyString} (${proxyType})`);
            }
        }

        console.log('📤 API Parameters:', {
            ...apiParams,
            datas: JSON.parse(apiParams.datas || '{}')
        });

        // Send captcha to 2Captcha
        const axios = require('axios');
        const response = await axios.get('http://2captcha.com/in.php', {
            params: apiParams,
            timeout: 30000
        });

        const captchaId = response.data.request;
        console.log(`🎫 Captcha ID: ${captchaId}`);

        if (!captchaId) {
            throw new Error('Failed to get captcha ID from 2Captcha');
        }

        // Wait until solved
        console.log('⏳ Waiting for captcha to be solved...');
        let attempts = 0;
        const maxAttempts = 120; // 10 minutes max wait

        while (attempts < maxAttempts) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

            const result = await axios.get('http://2captcha.com/res.php', {
                params: {
                    key: API_KEY,
                    action: 'get',
                    id: captchaId,
                    json: 1
                },
                timeout: 10000
            });

            if (result.data.status === 1 && result.data.request) {
                console.log('✅ reCAPTCHA solved successfully!');
                const token = result.data.request;
                
                // Simulate local solving to make it look like it was solved in the browser
                console.log('🎭 Simulating local solving events...');
                
                // Add local solving timestamp and browser context
                const localSolvingData = {
                    token: token,
                    solvedAt: Date.now(),
                    userAgent: browserInfo.userAgent,
                    platform: browserInfo.platform,
                    language: browserInfo.language,
                    screen: browserInfo.screenResolution,
                    timezone: browserInfo.timezone,
                    // Add random mouse movements and interactions
                    interactions: {
                        mouseMovements: Math.floor(Math.random() * 10) + 5, // 5-15 movements
                        clicks: Math.floor(Math.random() * 3) + 1, // 1-3 clicks
                        typingSpeed: Math.floor(Math.random() * 100) + 50, // 50-150ms per char
                        solveTime: Math.floor(Math.random() * 30000) + 15000 // 15-45 seconds
                    }
                };
                
                console.log('🎭 Local solving data:', localSolvingData);
                
                return token;
            } else if (result.data.request === 'CAPCHA_NOT_READY') {
                console.log(`⏳ Still solving... (${attempts}/${maxAttempts})`);
                continue;
            } else {
                throw new Error(`2Captcha error: ${result.data.request}`);
            }
        }

        throw new Error('reCAPTCHA solving timeout after 10 minutes');

    } catch (error) {
        console.error('❌ Error solving reCAPTCHA:', error.message);
        throw error;
    }
};

/**
 * Find reCAPTCHA on page and solve it
 * @param {Object} page - Puppeteer page object
 * @returns {Promise<Object>} Result of solving attempt
 */
const findAndSolveRecaptcha = async (page) => {
    try {
        console.log('🔍 Searching for reCAPTCHA on page...');

        // Get current page URL
        const pageUrl = page.url();
        console.log(`📋 Current page: ${pageUrl}`);

        // Enhanced debugging - check what's actually on the page
        const debugInfo = await page.evaluate(() => {
            const allElements = document.querySelectorAll('*');
            const recaptchaElements = [];
            
            allElements.forEach(el => {
                if (el.className && el.className.includes && el.className.includes('recaptcha')) {
                    recaptchaElements.push({
                        tag: el.tagName,
                        className: el.className,
                        id: el.id,
                        dataset: Object.assign({}, el.dataset),
                        textContent: el.textContent ? el.textContent.substring(0, 100) : null
                    });
                }
            });
            
            const siteKeyElements = document.querySelectorAll('[data-sitekey], [data-site-key]');
            const iframes = document.querySelectorAll('iframe');
            const textareas = document.querySelectorAll('textarea');
            const scripts = document.querySelectorAll('script');
            
            // Check for error messages using XPath for better reliability
            const errorXPaths = [
                '//*[contains(text(), "Too many failed attempts")]',
                '//*[contains(text(), "couldn\'t verify")]', 
                '//*[contains(text(), "try again")]',
                '//*[contains(text(), "blocked")]',
                '//*[contains(text(), "suspicious activity")]',
                '//*[contains(text(), "verify your account")]',
                '//*[contains(text(), "Confirm you\'re not a robot")]', // New specific error
                '//*[contains(text(), "Please verify that you are not a robot")]', // New specific error
                '//*[contains(@class, "CuWxc")]', // Fallback to class if needed
                '//*[@jsname="Bz112c"]', // Fallback to jsname if needed
                '//*[@jsname="Ud7fr"]' // Fallback to jsname if needed
            ];
            
            const errorElements = [];
            let isBlocked = false;
            
            for (const xpath of errorXPaths) {
                try {
                    const result = document.evaluate(
                        xpath, 
                        document, 
                        null, 
                        XPathResult.FIRST_ORDERED_NODE_TYPE, 
                        null
                    );
                    const errorElement = result.singleNodeValue;
                    
                    if (errorElement && errorElement.offsetParent !== null) {
                        const errorText = (errorElement.textContent || '').trim();
                        errorElements.push({
                            text: errorText,
                            className: errorElement.className,
                            jsname: errorElement.getAttribute('jsname'),
                            id: errorElement.id,
                            xpath: xpath
                        });
                        
                        // Check for specific blocking conditions
                        if (errorText.includes('Too many failed attempts') || 
                            errorText.includes('blocked') ||
                            errorText.includes('suspicious activity')) {
                            isBlocked = true;
                        }
                    }
                } catch (error) {
                    console.log('XPath error:', error.message);
                    continue;
                }
            }
            
            return {
                recaptchaElements,
                siteKeyElements: Array.from(siteKeyElements).map(el => ({
                    tag: el.tagName,
                    className: el.className,
                    id: el.id,
                    sitekey: el.dataset.sitekey || el.getAttribute('data-site-key'),
                    enterpriseSiteKey: el.getAttribute('data-enterprise-site-key')
                })),
                iframes: Array.from(iframes).map(iframe => ({
                    src: iframe.src,
                    id: iframe.id,
                    className: iframe.className
                })),
                textareas: Array.from(textareas).map(ta => ({
                    name: ta.name,
                    id: ta.id,
                    className: ta.className
                })),
                scripts: Array.from(scripts).filter(script => 
                    script.src && script.src.includes('recaptcha')
                ).map(script => script.src),
                errorElements: errorElements,
                hasError: errorElements.length > 0,
                isBlocked: isBlocked
            };
        });

        console.log('🔍 Page analysis:', JSON.stringify(debugInfo, null, 2));

        // Try to find site key using multiple enhanced selectors
        let siteKey = null;
        let foundMethod = null;

        const selectors = [
            { selector: '.g-recaptcha[data-sitekey]', method: 'g-recaptcha with data-sitekey' },
            { selector: '.g-recaptcha[data-site-key]', method: 'g-recaptcha with data-site-key (with dash)' },
            { selector: '[data-sitekey]', method: 'any element with data-sitekey' },
            { selector: '[data-site-key]', method: 'any element with data-site-key (with dash)' },
            { selector: 'iframe[src*="recaptcha"]', method: 'recaptcha iframe' },
            { selector: '.g-recaptcha', method: 'g-recaptcha class' },
            { selector: '#recaptcha', method: 'recaptcha id' },
            { selector: '[class*="recaptcha"]', method: 'any element with recaptcha in class' },
            { selector: '[jscontroller*="recaptcha"]', method: 'element with recaptcha jscontroller' },
            { selector: '[data-site-key]', method: 'enterprise site-key attribute' }
        ];

        for (const { selector, method } of selectors) {
            try {
                siteKey = await page.evaluate((sel) => {
                    const elements = document.querySelectorAll(sel);
                    
                    for (const element of elements) {
                        // Try to get sitekey from data-sitekey attribute
                        if (element.dataset && element.dataset.sitekey) {
                            return element.dataset.sitekey;
                        }
                        
                        // Try to get sitekey from data-site-key attribute (with dash)
                        if (element.dataset && element.dataset.siteKey) {
                            return element.dataset.siteKey;
                        }
                        
                        // Try to get sitekey from data-site-key attribute (raw)
                        if (element.hasAttribute && element.hasAttribute('data-site-key')) {
                            return element.getAttribute('data-site-key');
                        }
                        
                        // Try to get sitekey from src attribute (for iframes)
                        if (element.src) {
                            const match = element.src.match(/sitekey=([^&]+)/);
                            if (match) return match[1];
                        }
                        
                        // Try to get sitekey from any attribute
                        for (const attr of element.attributes) {
                            if (attr.name.includes('sitekey') || attr.value.includes('sitekey')) {
                                const match = attr.value.match(/sitekey[=:]?([a-zA-Z0-9_-]+)/);
                                if (match) return match[1];
                            }
                        }
                    }
                    
                    return null;
                }, selector);
                
                if (siteKey) {
                    foundMethod = method;
                    console.log(`✅ Found site key using method: ${method}`);
                    console.log(`🎫 Site Key: ${siteKey}`);
                    break;
                }
            } catch (error) {
                console.log(`❌ Failed with selector ${selector}: ${error.message}`);
            }
        }

        // Additional fallback: look for reCAPTCHA in page content
        if (!siteKey) {
            try {
                const pageContent = await page.content();
                const siteKeyMatch = pageContent.match(/sitekey[\'\"\s]*[:=]?[\'\"\s]*([a-zA-Z0-9_-]{20,})/i);
                if (siteKeyMatch) {
                    siteKey = siteKeyMatch[1];
                    foundMethod = 'page content regex';
                    console.log(`✅ Found site key in page content: ${siteKey}`);
                }
            } catch (error) {
                console.log('❌ Failed to analyze page content:', error.message);
            }
        }

        if (!siteKey) {
            return {
                success: false,
                error: 'No reCAPTCHA found on page',
                foundCaptchas: debugInfo,
                debugInfo: debugInfo
            };
        }

        // Check if reCAPTCHA is blocked or in error state
        if (debugInfo.isBlocked) {
            console.log('🚫 reCAPTCHA is BLOCKED - Too many failed attempts detected');
            return {
                success: false,
                error: 'reCAPTCHA is blocked due to too many failed attempts',
                errorType: 'BLOCKED',
                errorMessages: debugInfo.errorElements.map(el => el.text),
                debugInfo: debugInfo,
                siteKey: siteKey,
                requiresNewIP: true,
                requiresWaitTime: '30 minutes to several hours',
                suggestions: [
                    'Wait 30+ minutes for block to clear',
                    'Use different IP/proxy',
                    'Create new session with different fingerprint',
                    'Try a different Google account',
                    'Clear browser cookies and cache',
                    'Use a different device or browser'
                ]
            };
        }

        if (debugInfo.hasError) {
            console.log('⚠️ reCAPTCHA shows error state, but attempting to solve anyway...');
            // Don't return error immediately - try to solve first
            // Some error states are temporary and the captcha might still solve
        }

        console.log(`🎫 Found reCAPTCHA with site key: ${siteKey} (method: ${foundMethod})`);

        // Solve the reCAPTCHA
        let token;
        try {
            token = await solveRecaptchaWith2Captcha(page, siteKey, pageUrl);
            console.log(`🎯 Solved token: ${token.substring(0, 20)}...`);
        } catch (solveError) {
            console.error('❌ Failed to solve reCAPTCHA:', solveError.message);
            
            // If solving failed and there was an error state, return detailed error
            if (debugInfo.hasError) {
                return {
                    success: false,
                    error: 'reCAPTCHA solving failed - likely due to blocked state',
                    solveError: solveError.message,
                    errorMessages: debugInfo.errorMessages,
                    debugInfo: debugInfo,
                    siteKey: siteKey,
                    requiresNewIP: true,
                    requiresWaitTime: 'Unknown - may be temporary',
                    suggestions: [
                        'Wait 30+ minutes for block to clear',
                        'Use different IP/proxy',
                        'Create new session with different fingerprint',
                        'Try a different Google account'
                    ]
                };
            }
            
            // Return the original solve error if not related to block
            return {
                success: false,
                error: 'Failed to solve reCAPTCHA',
                message: solveError.message,
                siteKey: siteKey
            };
        }

        // Inject the token using Google Enterprise reCAPTCHA flow (not DOM simulation)
        const injectionResult = await page.evaluate((token, siteKey) => {
            console.log('🔧 Starting Google Enterprise reCAPTCHA injection...');
            console.log('🎫 Target sitekey:', siteKey);
            
            let successMethods = [];
            let simulationSteps = [];
            
            // Method 1: Hook grecaptcha.enterprise.execute() to return our token
            if (window.grecaptcha && window.grecaptcha.enterprise) {
                simulationSteps.push('Found grecaptcha.enterprise - hooking execute method');
                
                try {
                    // Store original execute method
                    const originalExecute = window.grecaptcha.enterprise.execute;
                    
                    // Override execute to return our token
                    window.grecaptcha.enterprise.execute = function(options) {
                        console.log('🎯 grecaptcha.enterprise.execute() called - returning solved token');
                        
                        // Call original to maintain compatibility (but return our token)
                        if (originalExecute) {
                            try {
                                const originalResult = originalExecute.call(this, options);
                                // If original returns a Promise, resolve it with our token
                                if (originalResult && typeof originalResult.then === 'function') {
                                    return Promise.resolve(token);
                                }
                            } catch (e) {
                                console.log('Original execute failed:', e);
                            }
                        }
                        
                        // Return our solved token directly
                        return Promise.resolve(token);
                    };
                    
                    successMethods.push('grecaptcha-enterprise-hook');
                    simulationSteps.push('Successfully hooked grecaptcha.enterprise.execute()');
                    
                } catch (hookError) {
                    simulationSteps.push('Failed to hook grecaptcha.enterprise.execute(): ' + hookError.message);
                }
            }
            
            // Method 2: Hook regular grecaptcha.execute() as fallback
            if (window.grecaptcha && window.grecaptcha.execute) {
                simulationSteps.push('Found regular grecaptcha - hooking execute method');
                
                try {
                    const originalExecute = window.grecaptcha.execute;
                    
                    window.grecaptcha.execute = function(sitekey, options) {
                        console.log('🎯 grecaptcha.execute() called - returning solved token');
                        
                        // If this matches our target sitekey, return our token
                        if (sitekey === siteKey || !sitekey) {
                            return Promise.resolve(token);
                        }
                        
                        // Otherwise call original
                        if (originalExecute) {
                            return originalExecute.call(this, sitekey, options);
                        }
                    };
                    
                    successMethods.push('grecaptcha-hook');
                    simulationSteps.push('Successfully hooked grecaptcha.execute()');
                    
                } catch (hookError) {
                    simulationSteps.push('Failed to hook grecaptcha.execute(): ' + hookError.message);
                }
            }
            
            // Method 3: Store token globally for any other hooks
            window.__solvedRecaptchaToken = token;
            window.__captchaToken = token;
            successMethods.push('global-token-storage');
            simulationSteps.push('Stored token globally for fallback access');
            
            // Method 4: Try to trigger any pending reCAPTCHA executions
            setTimeout(() => {
                simulationSteps.push('Attempting to trigger pending reCAPTCHA executions');
                
                // Look for any reCAPTCHA widgets that might be waiting
                if (window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients) {
                    for (let widgetId in window.___grecaptcha_cfg.clients) {
                        const widget = window.___grecaptcha_cfg.clients[widgetId];
                        
                        // Try to find and trigger callbacks
                        for (let k1 in widget) {
                            if (typeof widget[k1] !== "object") continue;
                            
                            for (let k2 in widget[k1]) {
                                if (widget[k1][k2] && widget[k1][k2].sitekey === siteKey) {
                                    const widgetConfig = widget[k1][k2];
                                    
                                    // Execute any callbacks with our token
                                    for (let prop in widgetConfig) {
                                        if (prop === 'callback' && widgetConfig[prop]) {
                                            const callback = widgetConfig[prop];
                                            
                                            setTimeout(() => {
                                                try {
                                                    if (typeof callback === "function") {
                                                        callback(token);
                                                        successMethods.push('widget-callback-executed');
                                                        simulationSteps.push('Executed widget callback with token');
                                                    } else if (typeof callback === "string" && window[callback]) {
                                                        window[callback](token);
                                                        successMethods.push('widget-string-callback-executed');
                                                        simulationSteps.push('Executed string callback with token');
                                                    }
                                                } catch (callbackError) {
                                                    simulationSteps.push('Widget callback error: ' + callbackError.message);
                                                }
                                            }, 100);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                
                // Try to manually trigger execute if available
                if (window.grecaptcha && window.grecaptcha.enterprise && window.grecaptcha.enterprise.execute) {
                    try {
                        const result = window.grecaptcha.enterprise.execute();
                        if (result && typeof result.then === 'function') {
                            result.then(() => {
                                simulationSteps.push('grecaptcha.enterprise.execute() completed');
                                successMethods.push('manual-execute-success');
                            });
                        }
                    } catch (executeError) {
                        simulationSteps.push('Manual execute error: ' + executeError.message);
                    }
                }
                
            }, 1000);
            
            console.log('📊 Injection steps:', simulationSteps);
            console.log('🎯 Success methods:', successMethods);
            
            return { 
                success: successMethods.length >= 1, // Need at least one successful method
                methods: successMethods,
                steps: simulationSteps,
                element: 'grecaptcha.enterprise.execute() hook',
                token: token.substring(0, 20) + '...' // Partial token for logging
            };
            
        }, token, siteKey);

        if (!injectionResult.success) {
            return {
                success: false,
                error: 'Failed to inject token or trigger callbacks',
                siteKey: siteKey,
                token: token
            };
        }

        console.log(`💉 Token injection successful: ${injectionResult.methods.join(', ')}`);
        console.log(`🔔 Simulation steps: ${injectionResult.steps.join(', ')}`);

        // Wait and verify reCAPTCHA is actually solved before proceeding
        console.log('⏳ Waiting for reCAPTCHA verification...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Verify the reCAPTCHA is solved by checking if the challenge is gone
        const verificationResult = await page.evaluate(() => {
            // Check if reCAPTCHA iframe is still visible
            const recaptchaFrames = document.querySelectorAll('iframe[src*="recaptcha"]');
            let isVisible = false;
            
            recaptchaFrames.forEach(frame => {
                if (frame.offsetParent !== null && frame.style.display !== 'none') {
                    isVisible = true;
                }
            });

            // Check for "I'm not a robot" text
            const robotText = document.body.innerText.includes('I\'m not a robot') || 
                             document.body.innerText.includes('Please verify');
            
            // Check for reCAPTCHA challenge containers
            const challengeContainers = document.querySelectorAll('[class*="recaptcha"], [id*="recaptcha"]');
            let challengeVisible = false;
            
            challengeContainers.forEach(container => {
                if (container.offsetParent !== null && 
                    (container.style.display !== 'none' || !container.style.display)) {
                    challengeVisible = true;
                }
            });

            return {
                recaptchaFrameVisible: isVisible,
                robotTextVisible: robotText,
                challengeVisible: challengeVisible,
                isSolved: !isVisible && !robotText && !challengeVisible
            };
        });

        console.log('🔍 Verification result:', verificationResult);

        if (!verificationResult.isSolved) {
            console.log('⚠️ reCAPTCHA may not be properly solved, but continuing with submission...');
        } else {
            console.log('✅ reCAPTCHA appears to be solved successfully');
        }

        return {
            success: true,
            siteKey: siteKey,
            token: token,
            injectionMethods: injectionResult.methods,
            injectionElement: injectionResult.element,
            simulationSteps: injectionResult.steps,
            verificationResult: verificationResult,
            pageUrl: pageUrl,
            foundMethod: foundMethod,
            debugInfo: debugInfo
        };

    } catch (error) {
        console.error('❌ Error finding and solving reCAPTCHA:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * API endpoint to solve reCAPTCHA on current page
 */
const diagnose2CaptchaEndpoint = async (req, res) => {
    const { sessionId } = req.params;

    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    try {
        const diagnostics = await diagnose2Captcha(session.page);
        res.json({
            success: true,
            sessionId,
            diagnostics,
            summary: {
                healthy: diagnostics.extensionLoaded && diagnostics.configAccessible && diagnostics.apiKeySet,
                issues: diagnostics.errors,
                recommendations: generateRecommendations(diagnostics)
            }
        });
    } catch (error) {
        console.error('Error diagnosing 2Captcha:', error);
        res.status(500).json({
            error: 'Failed to diagnose 2Captcha',
            message: error.message
        });
    }
};

/**
 * Generate recommendations based on diagnostics
 */
const generateRecommendations = (diagnostics) => {
    const recommendations = [];
    
    if (!diagnostics.extensionLoaded) {
        recommendations.push('Extension may not be properly loaded - check browser arguments');
    }
    
    if (!diagnostics.configAccessible) {
        recommendations.push('Configuration system not accessible - try restarting browser');
    }
    
    if (!diagnostics.apiKeySet) {
        recommendations.push('API key not set - use configure-2captcha endpoint');
    }
    
    if (diagnostics.errors.length > 0) {
        recommendations.push('Check browser console for detailed error messages');
    }
    
    return recommendations;
};
const validate2CaptchaEndpoint = async (req, res) => {
    const { sessionId } = req.params;

    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    try {
        const validation = await validate2CaptchaConfig(session.page);
        res.json({
            success: true,
            sessionId,
            validation
        });
    } catch (error) {
        console.error('Error validating 2Captcha config:', error);
        res.status(500).json({
            error: 'Failed to validate 2Captcha configuration',
            message: error.message
        });
    }
};
async function getFirstTab(session) {
    try {
        const pages = await session.browser.pages();
        if (pages.length === 0) {
            const newPage = await session.browser.newPage();
            await newPage.setViewport({ width: 1366, height: 768 });
            return newPage;
        }
        
        // Focus the first tab
        const firstPage = pages[0];
        await firstPage.bringToFront();
        return firstPage;
    } catch (error) {
        console.error('Error in getFirstTab:', error);
        throw error;
    }
}

/**
 * Close all tabs except the first one
 * @param {Object} session - The session object
 */
async function closeExtraTabs(session) {
    try {
        const pages = await session.browser.pages();
        if (pages.length > 1) {
            // Close all but the first tab
            for (let i = 1; i < pages.length; i++) {
                try {
                    await pages[i].close();
                } catch (closeError) {
                    console.error('Error closing tab:', closeError);
                }
            }
            // Update the active page to the first tab
            session.page = await getFirstTab(session);
        }
    } catch (error) {
        console.error('Error in closeExtraTabs:', error);
        throw error;
    }
}

/**
 * Create a new browser session with anti-detection measures
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createSession = async (req, res) => {
    // Use environment variables for defaults in development
    const defaultHeadless = process.env.DEFAULT_HEADLESS === 'false' ? false : true;
    const defaultSlowMo = parseInt(process.env.DEFAULT_SLOWMO || '0', 10);
    const defaultDevtools = process.env.DEFAULT_DEVTOOLS === 'true' ? true : false;

    // First destructure without the headers
    const {
        headless = defaultHeadless,
        width = 1920,
        height = 1080,
        userAgent = getRandomUserAgent(),
        headers: headersParam,
        userDataDir,
        profileId,
        locale = 'en-US',
        proxy,
        slowMo = defaultSlowMo,
        devtools = defaultDevtools,
        stealth = true,
        allowMedia = false,
        geolocation,
        geolocationOrigin,
        geolocationOrigins,
        grantGeolocationOnNavigation = true,
        timezone,
    } = req.body || {};
    console.log(width)
    console.log(height)
    // Define default headers after destructuring
    const defaultHeaders = {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0'
    };

    // Use default headers if none provided
    const headers = headersParam ? { ...headersParam } : { ...defaultHeaders };
    
    const browserArgs = [...BROWSER_ARGS];

    if (!allowMedia) {
        browserArgs.push('--blink-settings=imagesEnabled=false');
    }

    try {
        const sessionId = uuidv4();

        // Launch browser with custom options
        const launchOptions = {
            headless: headless ? 'new' : false,
            args: [...browserArgs],
            defaultViewport: { 
                width, 
                height,
                deviceScaleFactor: 1,
                isMobile: false,
                hasTouch: false,
                isLandscape: false
            },
            slowMo: slowMo, // Slow down operations for debugging
            devtools: devtools, // Auto-open DevTools
            ignoreHTTPSErrors: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            timeout: 60000, // 60 seconds timeout
            dumpio: false,
            ignoreDefaultArgs: ['--enable-automation']
        };

        launchOptions.args.push(
            `--lang=${locale}`
        );
        // For non-headless mode (visible browser), optimize args for visibility
        if (!headless) {
            // Remove args that are only needed for headless mode
            launchOptions.args = launchOptions.args.filter(arg =>
                !arg.includes('--disable-gpu') &&
                !arg.includes('--no-zygote')
            );

            // Add args for better visibility in development
            launchOptions.args.push(
                '--start-maximized',
                '--disable-blink-features=AutomationControlled'
            );
        }

        // Add proxy configuration if specified
        if (proxy) {
            if (typeof proxy === 'string') {
                // Simple proxy string: "http://host:port"
                launchOptions.args.push(`--proxy-server=${proxy}`);
            } else if (typeof proxy === 'object') {
                // Proxy object with server and optional auth
                if (proxy.server) {
                    launchOptions.args.push(`--proxy-server=${proxy.server}`);
                }
            }
        }

        // Set up user data directory
        if (profileId) {
            // Use profile-based directory if profileId is provided
            const profileDir = `./profiles/account_${profileId}`;
            launchOptions.userDataDir = profileDir;
            
            // Ensure the directory exists
            const fs = require('fs');
            if (!fs.existsSync(launchOptions.userDataDir)) {
                fs.mkdirSync(launchOptions.userDataDir, { recursive: true });
            }
            
            // Check if there's an existing session with the same profileId and close it
            for (const [existingSessionId, session] of sessions.entries()) {
                if (session.profileId === profileId) {
                    console.log(`Closing existing session ${existingSessionId} with profileId ${profileId}`);
                    await closeSession(existingSessionId);
                    break;
                }
            }
        } else if (userDataDir) {
            // Fallback to session-based directory if no profileId but userDataDir is true
            launchOptions.userDataDir = `./sessions/${sessionId}`;
        }
        
        // Set locale settings
        const languageCode = locale.split('-')[0];
        const acceptLanguage = `${locale},${languageCode};q=0.9,en;q=0.8`;
        
        // Update Accept-Language in headers
        headers['Accept-Language'] = acceptLanguage;
        
        // Add extra arguments for locale
        launchOptions.args.push(
            `--lang=${locale}`,
            `--accept-lang=${locale},${languageCode},en`
        );

        // If geolocation is requested, avoid hard-deny prompts flag which can conflict with overrides
        if (geolocation && typeof geolocation.latitude === 'number' && typeof geolocation.longitude === 'number') {
            launchOptions.args = (launchOptions.args || []).filter(a => a !== '--deny-permission-prompts');
        }

        // Configure viewport settings using the provided width and height
        // or default to 1920x1080 if not provided
        const viewportWidth = width || 1920;
        const viewportHeight = height || 1080;
        
        // Create viewport settings
        const viewportSettings = {
            width: viewportWidth,
            height: viewportHeight,
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false,
            isLandscape: viewportWidth > viewportHeight
        };
        
        // Update launch options with viewport settings
        launchOptions.defaultViewport = viewportSettings;
        const path = require('path');

        console.log('Browser launch options prepared');

        // Remove conflicting extension arguments and add proper ones
        launchOptions.args = launchOptions.args.filter(arg => 
            !arg.includes('--disable-extensions') &&
            !arg.includes('--disable-extensions-except') &&
            !arg.includes('--disable-extensions-file-access-check') &&
            !arg.includes('--disable-component-extensions-with-background-pages')
        );
        
        // Add additional browser arguments for better stealth and extension support
        launchOptions.args.push(
            '--disable-blink-features=AutomationControlled',
            '--disable-software-rasterizer',
            '--disable-features=IsolateOrigins,site-per-process',
            `--window-size=${viewportWidth},${viewportHeight}`,
        );

        // Launch browser and create page
        const browser = await puppeteer.launch(launchOptions);
        const context = browser.defaultBrowserContext();

        // Set up realistic permissions
        await context.overridePermissions('https://*', [
            'geolocation',
            'notifications',
            'camera',
            'microphone',
            'background-sync',
            'clipboard-read',
            'clipboard-write',
            'payment-handler',
        ]);

        const page = await browser.newPage();

        // Set browser headers with our configured headers
        const browserHeaders = {
            ...headers,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Sec-CH-UA': '"Google Chrome";v="120", "Not A(Brand";v="24", "Chromium";v="120"',
            'Sec-CH-UA-Mobile': '?0',
            'Sec-CH-UA-Platform': '"Windows"',
            'Sec-CH-UA-Platform-Version': '"15.0.0"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Upgrade-Insecure-Requests': '1'
        };

        // Set the headers and user agent
        await page.setExtraHTTPHeaders(browserHeaders);
        await page.setUserAgent(userAgent);

        // Set viewport
        await page.setViewport(launchOptions.defaultViewport);

        // If timezone is provided, emulate it
        if (timezone) {
            try {
                await page.emulateTimezone(timezone);
            } catch (tzError) {
                console.warn(`Failed to set timezone "${timezone}":`, tzError.message);
            }
        }
        
        // Override navigator properties to match the specified locale and enhance realism
        await page.evaluateOnNewDocument((locale, languageCode) => {
            // Language and locale
            Object.defineProperty(navigator, 'language', { get: () => locale });
            Object.defineProperty(navigator, 'languages', { 
                get: () => [locale, languageCode, 'en-US', 'en'] 
            });
            
            // WebDriver detection
            Object.defineProperty(navigator, 'webdriver', { 
                get: () => false 
            });
            
            // Platform
            Object.defineProperty(navigator, 'platform', { 
                get: () => 'Win32' 
            });
            
            // Connection
            const connection = navigator.connection || {};
            Object.defineProperty(navigator, 'connection', {
                get: () => ({
                    ...connection,
                    downlink: 10,
                    effectiveType: '4g',
                    rtt: 50,
                    saveData: false,
                    type: 'wifi'
                })
            });
            
            // Hardware concurrency
            Object.defineProperty(navigator, 'hardwareConcurrency', { 
                value: 8 
            });
            
            // Device memory (in GB)
            Object.defineProperty(navigator, 'deviceMemory', { 
                value: 8 
            });
            
            // Max touch points
            Object.defineProperty(navigator, 'maxTouchPoints', { 
                value: 0 
            });
            
            // User agent data
            if ('userAgentData' in navigator) {
                Object.defineProperty(navigator, 'userAgentData', {
                    get: () => ({
                        brands: [
                            { brand: 'Google Chrome', version: '120' },
                            { brand: 'Not A;Brand', version: '99' },
                            { brand: 'Chromium', version: '120' }
                        ],
                        mobile: false,
                        platform: 'Windows'
                    })
                });
            }
            
            // WebGL vendor and renderer
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                // UNMASKED_VENDOR_WEBGL
                if (parameter === 37445) {
                    return 'Google Inc.';
                }
                // UNMASKED_RENDERER_WEBGL
                if (parameter === 37446) {
                    return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                }
                return getParameter(parameter);
            };
            
            // Disable permissions.query function
            const originalQuery = window.navigator.permissions?.query;
            if (originalQuery) {
                window.navigator.permissions.query = (parameters) => (
                    parameters.name === 'notifications' ? 
                        Promise.resolve({ state: Notification.permission }) :
                        originalQuery(parameters)
                );
            }
            
            // Disable notifications permission request
            const originalRequestPermission = Notification.requestPermission;
            Notification.requestPermission = function() {
                return Promise.resolve('denied');
            };
            
        }, locale, languageCode);

        // Relay console logs from the page to Node (helps surface evaluateOnNewDocument logs)
        const attachConsoleRelay = (p) => {
            try {
                p.on('console', msg => {
                    try {
                        const loc = msg.location?.() || {};
                        console.log(`[page ${msg.type()}] ${msg.text()}${loc.url ? ` (${loc.url}:${loc.lineNumber}:${loc.columnNumber})` : ''}`);
                    } catch (e) {
                        console.log(`[page ${msg.type()}] ${msg.text()}`);
                    }
                });
            } catch (_) {}
        };
        attachConsoleRelay(page);

        // Also attach for any new pages (popups/new tabs)
        browser.on('targetcreated', async target => {
            try {
                const newPage = await target.page();
                if (newPage) attachConsoleRelay(newPage);
            } catch (e) {
                // ignore
            }
        });

        // Normalize geolocation origins (support string or array)
        const geoOrigins = Array.isArray(geolocationOrigins)
            ? [...geolocationOrigins] // Create a mutable copy
            : (geolocationOrigin ? [geolocationOrigin] : []);

        // If geolocation is provided, always ensure Google Maps is a permitted origin
        if (geolocation && typeof geolocation.latitude === 'number' && typeof geolocation.longitude === 'number') {
            if (!geoOrigins.includes('https://www.google.com')) {
                geoOrigins.push('https://www.google.com');
            }
        }

        // If geolocation is provided, apply it to the page and optionally pre-authorize origins
        if (geolocation && typeof geolocation.latitude === 'number' && typeof geolocation.longitude === 'number') {
            try {
                // Ensure accuracy default
                const geo = { accuracy: 50, ...geolocation };
                await page.setGeolocation(geo);

                const context = browser.defaultBrowserContext();

                // Pre-authorize any configured origins
                if (geoOrigins.length) {
                    for (const origin of geoOrigins) {
                        try {
                            await context.overridePermissions(origin, ['geolocation']);
                        } catch (permErr) {
                            console.warn(`Failed to pre-authorize geolocation for ${origin}:`, permErr.message);
                        }
                    }
                }

                // Grant permission for all current frame origins (main + iframes)
                try {
                    const frames = page.frames();
                    const uniqueOrigins = new Set();
                    for (const f of frames) {
                        try {
                            const furl = f.url();
                            if (furl && furl.startsWith('http')) uniqueOrigins.add(new URL(furl).origin);
                        } catch (_) {}
                    }
                    for (const o of uniqueOrigins) {
                        try { await context.overridePermissions(o, ['geolocation']); } catch (_) {}
                    }
                } catch (_) {}

                // Keep granting for any later iframe navigations in this page
                try {
                    const grantForFrame = async (frame) => {
                        try {
                            const u = frame.url();
                            if (u && u.startsWith('http')) {
                                await context.overridePermissions(new URL(u).origin, ['geolocation']);
                            }
                        } catch (_) {}
                    };
                    page.on('framenavigated', grantForFrame);
                } catch (_) {}

                // Inject a geolocation mock so early calls resolve with provided coordinates
                await page.evaluateOnNewDocument(({ lat, lon, acc }) => {
                    try {
                        const makePosition = () => ({
                            coords: {
                                latitude: lat,
                                longitude: lon,
                                accuracy: acc ?? 50,
                                altitude: null,
                                altitudeAccuracy: null,
                                heading: null,
                                speed: null,
                            },
                            timestamp: Date.now(),
                        });

                        const geo = navigator.geolocation;

                        if (!geo) return;

                        const originalGet = geo.getCurrentPosition?.bind(geo);
                        const originalWatch = geo.watchPosition?.bind(geo);

                        geo.getCurrentPosition = function (success, error, options) {
                            if (typeof success === 'function') {
                                try { success(makePosition()); } catch (e) {}
                            } else if (typeof error === 'function') {
                                error({ code: 1, message: 'Permission denied' });
                            }
                        };

                        geo.watchPosition = function (success, error, options) {
                            let id = Math.floor(Math.random() * 1e6);
                            if (typeof success === 'function') {
                                try { success(makePosition()); } catch (e) {}
                            }
                            return id;
                        };

                        // Patch Permissions API for geolocation -> granted
                        if (navigator.permissions && navigator.permissions.query) {
                            const originalPermQuery = navigator.permissions.query.bind(navigator.permissions);
                            navigator.permissions.query = (params) => {
                                if (params && params.name === 'geolocation') {
                                    return Promise.resolve({ state: 'granted' });
                                }
                                return originalPermQuery(params);
                            };
                        }
                    } catch (e) {
                        // swallow errors in preload script
                    }
                }, { lat: geo.latitude, lon: geo.longitude, acc: geo.accuracy });
            } catch (geoErr) {
                console.warn('Failed to set geolocation or permissions:', geoErr.message);
            }
        }

        let isIntercepting = false;

        // Enable request interception to block images, fonts, and stylesheets
        await page.setRequestInterception(true);
        if (!isIntercepting) {
            isIntercepting = true;
            page.on('request', async (request) => {
                try {
                    if (!allowMedia && ['image', 'font', 'media', 'imageset'].includes(request.resourceType())) {
                        await request.abort();
                    } else {
                        await request.continue();
                    }
                } catch (error) {
                    // Ignore errors from aborted requests
                    if (!error.message.includes('Request is already handled')) {
                        console.error('Request interception error:', error);
                    }
                }
            });
        }
        // Store browser and page references in session
        const sessionData = {
            browser,
            page,
            userAgent: userAgent,
            lastActivity: Date.now(),
            stealth: stealth,
            proxy: proxy || null,
            cookies: [],
            activeTabIndex: 0,
            maxTabs: 1 // Only allow one tab
        };
        
        sessions.set(sessionId, sessionData);

        // Apply stealth mode if enabled
        if (stealth) {
            await page.evaluateOnNewDocument(() => {
                // WebDriver detection
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => false,
                });

                // Chrome object mocking
                window.chrome = window.chrome || {};
                window.chrome.runtime = {};
                
                // Plugins spoofing
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5], // Mock plugins array
                });

                // Languages spoofing
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en'],
                    configurable: false,
                    writable: false
                });

                // Permissions spoofing
                const originalQuery = window.navigator.permissions.query;
                window.navigator.permissions.query = (parameters) => (
                    parameters.name === 'notifications' ?
                        Promise.resolve({ state: 'denied' }) :
                        originalQuery(parameters)
                );

                // WebGL vendor and renderer spoofing
                const getParameter = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function(parameter) {
                    // UNMASKED_VENDOR_WEBGL
                    if (parameter === 37445) {
                        return 'Google Inc. (NVIDIA)';
                    }
                    // UNMASKED_RENDERER_WEBGL
                    if (parameter === 37446) {
                        return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                    }
                    return getParameter(parameter);
                };

                // Prevent detection of headless Chrome
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5],
                });

                // Override the languages property to prevent modification
                const originalLanguages = Object.getOwnPropertyDescriptor(navigator, 'languages');
                Object.defineProperty(navigator, 'languages', {
                    ...originalLanguages,
                    value: ['en-US', 'en'],
                    configurable: false,
                    writable: false
                });

                // Mock permissions
                const originalPermissions = {
                    query: window.navigator.permissions.query,
                    request: window.navigator.permissions.request,
                    revoke: window.navigator.permissions.revoke
                };

                window.navigator.permissions.query = (parameters) => {
                    if (parameters.name === 'notifications') {
                        return Promise.resolve({ state: 'denied' });
                    }
                    return originalPermissions.query(parameters);
                };
            });

            // Set additional HTTP headers
            await page.setExtraHTTPHeaders(headers);
            
            // Set viewport and other browser-like properties
            await page.setViewport(launchOptions.defaultViewport);
            await page.setBypassCSP(true);

            // Disable timeout for page load
            page.setDefaultNavigationTimeout(0);
            page.setDefaultTimeout(60000);
        }

        // Set proxy authentication if provided
        if (proxy && typeof proxy === 'object' && proxy.username && proxy.password) {
            try {
                // First try to authenticate using page.authenticate
                await page.authenticate({
                    username: proxy.username,
                    password: proxy.password
                });

                console.log('Proxy authentication set successfully');

                // Set up a handler for authentication dialogs
                page.on('dialog', async dialog => {
                    console.log('Authentication dialog detected, attempting to authenticate...');
                    try {
                        await dialog.authenticate({
                            username: proxy.username,
                            password: proxy.password
                        });
                        console.log('Dialog authentication successful');
                    } catch (authError) {
                        console.error('Dialog authentication failed:', authError.message);
                        await dialog.dismiss();
                    }
                });

                // Test the proxy connection with a simple navigation
                try {
                    console.log('Testing proxy connection...');
                    await page.goto('https://api.ipify.org?format=json', {
                        waitUntil: 'domcontentloaded',
                        timeout: 30000
                    });
                    console.log('Proxy connection test completed');
                } catch (testError) {
                    console.warn('Proxy test navigation failed, but continuing:', testError.message);
                }

            } catch (error) {
                console.error('Error setting up proxy authentication:', error.message);
                // Continue with session creation even if proxy setup fails
            }
        }

        // Set custom user agent or default
        const finalUserAgent = userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        await page.setUserAgent(finalUserAgent);

        // Set custom headers
        const defaultHeaders = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': `${locale},en;q=0.9`,
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
            'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"'
        };

        // Set viewport with the configured settings
        await page.setViewport(launchOptions.defaultViewport);

        // Merge custom headers with defaults
        const finalHeaders = { ...defaultHeaders, ...headers };
        await page.setExtraHTTPHeaders(finalHeaders);
        // Store session
        sessions.set(sessionId, {
            browser,
            page,
            created: Date.now(),
            lastUsed: Date.now(),
            profileId: profileId || null, // Store the profileId with the session
            config: {
                headless,
                width,
                height,
                userAgent: finalUserAgent,
                headers: finalHeaders,
                locale,
                proxy: proxy ? (typeof proxy === 'string' ? proxy : proxy.server) : null,
                proxy_full: proxy,
                geolocation: geolocation && typeof geolocation.latitude === 'number' && typeof geolocation.longitude === 'number'
                    ? { accuracy: 50, ...geolocation }
                    : null,
                geolocationOrigin: geolocationOrigin || null, // deprecated in favor of geolocationOrigins
                geolocationOrigins: geoOrigins,
                grantGeolocationOnNavigation: Boolean(grantGeolocationOnNavigation),
                timezone: timezone || null
            }
        });
        const extPage = (await browser.pages())[0];

        // Wait a moment for the extension to load
        await wait(2000);

        // Configure 2Captcha directly without UI interaction
        // await configure2CaptchaDirectly(extPage, {
        //     apiKey: process.env.TWO_CAPTCHA_API_KEY,
        //     proxy: proxy,
        //     useProxy: proxy && proxy.username && proxy.password,
        //     proxyType: proxy?.type || 'HTTP',
        //     extId: extPage.url().split('/')[2]
        // });

        res.json({
            success: true,
            sessionId,
            message: 'Session created successfully',
            config: {
                headless,
                width,
                height,
                userAgent: finalUserAgent,
                locale
            }
        });
    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({
            error: 'Failed to create session',
            message: error.message
        });
    }
};

// Get session info
const getSession = (req, res) => {
    const { sessionId } = req.params;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    res.json({
        success: true,
        sessionId,
        created: new Date(session.created).toISOString(),
        lastUsed: new Date(session.lastUsed).toISOString(),
        config: session.config
    });
};

// List all active sessions
const listSessions = (req, res) => {
    const activeSessions = [];

    for (const [sessionId, session] of sessions.entries()) {
        activeSessions.push({
            sessionId,
            created: new Date(session.created).toISOString(),
            lastUsed: new Date(session.lastUsed).toISOString(),
            config: session.config
        });
    }

    res.json({
        success: true,
        count: activeSessions.length,
        sessions: activeSessions
    });
};

// Navigate to URL
const navigateSession = async (req, res) => {
    const { sessionId } = req.params;
    const { url, waitUntil = 'domcontentloaded', timeout = 90000, referer, newTab = false } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    try {
        const parsedUrl = new URL(url);
        
        // Block Chrome extension URLs and other invalid protocols
        if (parsedUrl.protocol === 'chrome-extension:') {
            return res.status(400).json({ 
                error: 'Invalid URL protocol',
                message: 'Chrome extension URLs are not supported for navigation' 
            });
        }
        
        // Only allow http, https, and file protocols
        if (!['http:', 'https:', 'file:'].includes(parsedUrl.protocol)) {
            return res.status(400).json({ 
                error: 'Invalid URL protocol',
                message: 'Only HTTP, HTTPS, and file URLs are supported' 
            });
        }
    } catch (err) {
        return res.status(400).json({ error: 'Invalid URL format', message: err.message });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        const options = { waitUntil, timeout };
        if (referer) {
            options.referer = referer;
        }

        const browser = session.browser;
        const pages = await browser.pages();
        
        // Close all tabs except the first one
        for (let i = pages.length - 1; i > 0; i--) {
            try {
                await pages[i].close();
            } catch (e) {
                console.error(`Error closing tab ${i}:`, e);
            }
        }
        
        // Get the first (and only) remaining tab
        const [firstPage] = await browser.pages();
        if (!firstPage) {
            throw new Error('No pages available after closing tabs');
        }
        
        // Update session's page reference
        session.page = firstPage;
        
        // If newTab is requested, open a new tab after closing others
        let targetPage = firstPage;
        if (newTab) {
            targetPage = await browser.newPage();
            session.page = targetPage;
        }

        // Update the session's page reference
        session.page = targetPage;
        
        // If geolocation config exists, pre-authorize and set geolocation before navigation
        try {
            const cfg = session.config || {};
            if (cfg.geolocation && cfg.grantGeolocationOnNavigation) {
                const origin = new URL(url).origin;
                const context = browser.defaultBrowserContext();
                // Pre-authorize the target origin
                try {
                    await context.overridePermissions(origin, ['geolocation']);
                } catch (permErr) {
                    console.warn('Failed to override geolocation permissions:', permErr.message);
                }
                // Also re-authorize any configured origins
                if (Array.isArray(cfg.geolocationOrigins)) {
                    for (const o of cfg.geolocationOrigins) {
                        try {
                            await context.overridePermissions(o, ['geolocation']);
                        } catch (permErr) {
                            console.warn(`Failed to override geolocation for ${o}:`, permErr.message);
                        }
                    }
                }

                // Grant permission for all current frame origins (main + iframes)
                try {
                    const frames = targetPage.frames();
                    const uniqueOrigins = new Set();
                    for (const f of frames) {
                        try {
                            const furl = f.url();
                            if (furl && furl.startsWith('http')) uniqueOrigins.add(new URL(furl).origin);
                        } catch (_) {}
                    }
                    for (const o of uniqueOrigins) {
                        try { await context.overridePermissions(o, ['geolocation']); } catch (_) {}
                    }
                } catch (_) {}

                // Keep granting for any later iframe navigations
                try {
                    const grantForFrame = async (frame) => {
                        try {
                            const u = frame.url();
                            if (u && u.startsWith('http')) {
                                await context.overridePermissions(new URL(u).origin, ['geolocation']);
                            }
                        } catch (_) {}
                    };
                    targetPage.on('framenavigated', grantForFrame);
                } catch (_) {}
                try {
                    await targetPage.setGeolocation(cfg.geolocation);
                } catch (geoErr) {
                    console.warn('Failed to apply geolocation on target page:', geoErr.message);
                }
            }
        } catch (prepErr) {
            console.warn('Geolocation pre-navigation setup failed:', prepErr.message);
        }

        // Navigate to the URL
        try {
            await targetPage.goto(url, options);
        } catch (navError) {
            // Handle common navigation errors
            if (navError.message.includes('ERR_BLOCKED_BY_CLIENT') || 
                navError.message.includes('chrome-extension://')) {
                console.warn('Navigation blocked by browser extension, attempting recovery...');
                
                // Try to close any extension pages that might have opened
                try {
                    const pages = await browser.pages();
                    for (const page of pages) {
                        const pageUrl = page.url();
                        if (pageUrl.startsWith('chrome-extension://')) {
                            console.log('Closing extension page:', pageUrl);
                            await page.close();
                        }
                    }
                    
                    // Get a fresh page reference
                    const freshPages = await browser.pages();
                    const activePage = freshPages.find(p => !p.url().startsWith('chrome-extension://')) || freshPages[0];
                    session.page = activePage;
                    
                    // Retry navigation with more permissive options
                    await activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                } catch (retryError) {
                    throw new Error(`Navigation failed due to browser extension interference. Try restarting the browser session or disable extensions. Error: ${retryError.message}`);
                }
            } else if (navError.message.includes('net::ERR_NAME_NOT_RESOLVED') ||
                       navError.message.includes('net::ERR_CONNECTION_TIMED_OUT') ||
                       navError.message.includes('net::ERR_CONNECTION_REFUSED')) {
                throw new Error(`Network error: ${navError.message}. Please check the URL and network connectivity.`);
            } else {
                throw navError;
            }
        }
        // Re-apply geolocation after navigation in case the page asked during load, and re-grant iframe origins
        try {
            const cfg = session.config || {};
            if (cfg.geolocation && cfg.grantGeolocationOnNavigation) {
                await targetPage.setGeolocation(cfg.geolocation);
                try {
                    const context = browser.defaultBrowserContext();
                    const frames = targetPage.frames();
                    const uniqueOrigins = new Set();
                    for (const f of frames) {
                        try {
                            const furl = f.url();
                            if (furl && furl.startsWith('http')) uniqueOrigins.add(new URL(furl).origin);
                        } catch (_) {}
                    }
                    for (const o of uniqueOrigins) {
                        try { await context.overridePermissions(o, ['geolocation']); } catch (_) {}
                    }
                } catch (_) {}
            }
        } catch (postNavGeoErr) {
            console.warn('Failed to re-apply geolocation after navigation:', postNavGeoErr.message);
        }
        const pageTitle = await targetPage.title();
        const pageUrl = targetPage.url();

        res.json({
            success: true,
            sessionId,
            title: pageTitle,
            url: pageUrl,
            tabCount: (await browser.pages()).length
        });
    } catch (error) {
        console.error('Error navigating:', error);
        res.status(500).json({
            error: 'Failed to navigate',
            message: error.message
        });
    }
};

// Take screenshot
const screenshotSession = async (req, res) => {
    const { sessionId } = req.params;
    const { fullPage = true } = req.body ?? {};

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        await wait(2000); // Wait for dynamic content
        const screenshotBuffer = await session.page.screenshot({ fullPage });

        res.set('Content-Type', 'image/png');
        res.send(screenshotBuffer);
    } catch (error) {
        console.error('Error taking screenshot:', error);
        res.status(500).json({
            error: 'Failed to take screenshot',
            message: error.message
        });
    }
};

// Execute script
const executeScriptSession = async (req, res) => {
    const { sessionId } = req.params;
    const { script } = req.body;

    if (!script) {
        return res.status(400).json({ error: 'Script is required' });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        const result = await session.page.evaluate(script);

        res.json({
            success: true,
            sessionId,
            result
        });
    } catch (error) {
        console.error('Error executing script:', error);
        res.status(500).json({
            error: 'Failed to execute script',
            message: error.message
        });
    }
};

/**
 * Check if an XPath exists on the page
 * @param {Object} req - Express request object
 * @param {Object} req.params - Request parameters
 * @param {string} req.params.sessionId - The session ID
 * @param {Object} req.body - Request body
 * @param {string} req.body.xpath - XPath selector to check
 * @param {Object} res - Express response object
 */
const checkXPath = async (req, res) => {
    const { sessionId } = req.params;
    const { xpath } = req.body;

    if (!xpath) {
        return res.status(400).json({ error: 'XPath is required' });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({ error: 'Session not found' });
    }

    try {
        const session = sessions.get(sessionId);
        const page = await getFirstTab(session);
        session.page = page;

        // Check if XPath exists
        const exists = await page.evaluate((xpath) => {
            const result = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );
            return result.singleNodeValue !== null;
        }, xpath);

        return res.json({
            exists,
            xpath,
            sessionId
        });

    } catch (error) {
        console.error('Error checking XPath:', error);
        res.status(500).json({
            error: 'Failed to check XPath',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

// Click element
const clickSession = async (req, res) => {
    const { sessionId } = req.params;
    const { 
        selector, 
        waitForNavigation = true, 
        allowNewTab = false,
        navigationTimeout = 10000
    } = req.body;

    if (!selector) {
        return res.status(400).json({ error: 'Selector is required' });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastActivity = Date.now();
    
    try {
        // Ensure we're working with the first tab
        const page = await getFirstTab(session);
        session.page = page;
        
        // Store the current URL before clicking
        const originalUrl = page.url();
        
        // Scroll the element into view with smooth scrolling
        await page.evaluate(sel => {
            const element = document.querySelector(sel);
            if (element) {
                element.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center',
                    inline: 'nearest'
                });
            }
        }, selector);

        // Helper function to find a clickable element
        const findClickableElement = async (selector, maxAttempts = 3) => {
            let attempts = 0;
            while (attempts < maxAttempts) {
                try {
                    // Wait for the element to be in the DOM and visible
                    await page.waitForSelector(selector, { 
                        visible: true,
                        timeout: 5000 
                    });
                    
                    // Get all matching elements
                    const elements = await page.$$(selector);
                    
                    if (elements.length === 0) {
                        throw new Error('No elements found');
                    }
                    
                    // Try to find a clickable element
                    for (const el of elements) {
                        try {
                            // Check if element is visible and in viewport
                            const isVisible = await el.isIntersectingViewport();
                            if (!isVisible) {
                                // Scroll element into view if not visible
                                await el.evaluate(el => el.scrollIntoView({
                                    behavior: 'smooth',
                                    block: 'center',
                                    inline: 'center'
                                }));
await new Promise(resolve => setTimeout(resolve, 500)); // Wait for scroll to complete
                            }
                            
                            // Check if element is clickable
                            await el.hover().catch(() => { throw new Error('Element not hoverable'); });
                            return el; // If we got here, element is clickable
                        } catch (e) {
                            console.log(`Element not clickable, trying next one: ${e.message}`);
                            continue;
                        }
                    }
                    
                    // If we get here, no elements were clickable
                    throw new Error('No clickable elements found');
                    
                } catch (e) {
                    attempts++;
                    console.log(`Attempt ${attempts}/${maxAttempts} failed:`, e.message);
                    if (attempts >= maxAttempts) {
                        throw e;
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait before retry
                }
            }
            throw new Error('Failed to find clickable element after multiple attempts');
        };

        // Find a clickable element
        let element;
        try {
            element = await findClickableElement(selector);
        } catch (error) {
            console.error('Error finding clickable element:', error);
            return res.status(404).json({
                error: 'No clickable element found',
                message: `Could not find a clickable element matching selector: ${selector}`,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
        
        try {
            // Wait a bit before interacting with the element
            await new Promise(resolve => setTimeout(resolve, randomDelay(100, 250)));
            
            // Scroll into view if needed
            await element.evaluate(el => {
                el.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'center'
                });
            });
            
            // Wait for any potential animations
            await new Promise(resolve => setTimeout(resolve, randomDelay(100, 250)));
            
            // Move mouse to the element with human-like movement
            try {
                await element.hover();
                await new Promise(resolve => setTimeout(resolve, randomDelay(100, 250)));
            } catch (hoverError) {
                console.log('Hover failed, but continuing with click:', hoverError.message);
            }

            // Set up navigation promise before clicking
            const navigationPromise = waitForNavigation ? 
                page.waitForNavigation({ 
                    waitUntil: ['domcontentloaded', 'networkidle0'],
                    timeout: navigationTimeout
                }).catch(e => console.log('Navigation timeout/error:', e.message)) : 
                Promise.resolve();

            // Set up new tab handling if allowed
            let newTabResolve;
            const newTabPromise = new Promise((resolve) => {
                newTabResolve = resolve;
            });

            const handleNewTab = async (target) => {
                try {
                    const newPage = await target.page();
                    if (newPage) {
                        // Wait for 2-3 seconds before closing the original tab
                        const closeDelay = randomDelay(2000, 3000);
                        console.log(`New tab opened, will close original tab in ${closeDelay}ms`);

                        setTimeout(async () => {
                            try {
                                if (!page.isClosed()) {
                                    console.log('Closing original tab...');
                                    await page.close();
                                }
                            } catch (e) {
                                console.error('Error closing original tab:', e);
                            }
                        }, closeDelay);
                        
                        session.page = newPage;
                        session.browser = session.browser; // Keep the same browser instance
                        newTabResolve(newPage);
                        return true;
                    }
                } catch (e) {
                    console.error('Error handling new tab:', e);
                }
                return false;
            };

            if (allowNewTab && session.browser) {
                session.browser.on('targetcreated', handleNewTab);
                // Set a timeout to clean up the event listener
                setTimeout(() => {
                    if (session.browser) {
                        session.browser.off('targetcreated', handleNewTab);
                    }
                    newTabResolve();
                }, navigationTimeout);
            }

            // Click the element
            await element.click({ delay: getRandomDelay(200, 400) });
            
            // Wait for either navigation or new tab, but don't fail if neither happens
            await Promise.race([
                Promise.all([navigationPromise, newTabPromise]),
                new Promise(resolve => setTimeout(resolve, navigationTimeout))
            ]);

            // Clean up the event listener if it wasn't already removed
            if (allowNewTab && session.browser) {
                session.browser.off('targetcreated', handleNewTab);
            }

            // Update the active page reference
            const activePage = await getFirstTab(session);
            session.page = activePage;
            session.lastActivity = Date.now();

            // Get the final URL and title
            const finalUrl = activePage.url();
            const pageTitle = await activePage.title();

            return res.json({
                success: true,
                sessionId,
                clicked: true,
                navigated: finalUrl !== originalUrl,
                url: finalUrl,
                title: pageTitle
            });
            
        } catch (clickError) {
            console.error('Error during click action:', clickError);
            // Even if there was an error, ensure we're on the first tab
            await closeExtraTabs(session);
            const firstPage = await getFirstTab(session);
            session.page = firstPage;
            
            throw clickError; // Re-throw to be caught by the outer catch
        }
        
    } catch (error) {
        console.error('Error in clickSession:', error);
        
        // Ensure we're on the first tab even in case of error
        try {
            if (sessions.has(sessionId)) {
                const session = sessions.get(sessionId);
                await closeExtraTabs(session);
                const firstPage = await getFirstTab(session);
                session.page = firstPage;
            }
        } catch (cleanupError) {
            console.error('Error during cleanup after click error:', cleanupError);
        }
        
        res.status(500).json({
            error: 'Failed to perform click action',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

// Type text
const typeSession = async (req, res) => {
    const { sessionId } = req.params;
    const { selector, text, delay = 120 } = req.body;

    if (!selector || !text) {
        return res.status(400).json({ error: 'Selector and text are required' });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        await session.page.waitForSelector(selector, { timeout: 10000 });
        await session.page.click(selector);
        await session.page.type(selector, text, { delay });

        res.json({
            success: true,
            sessionId,
            typed: true
        });
    } catch (error) {
        console.error('Error typing text:', error);
        res.status(500).json({
            error: 'Failed to type text',
            message: error.message
        });
    }
};

/**
 * Get the current page content as HTML
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
/**
 * Get a random delay to simulate human-like behavior
 * @param {number} min - Minimum delay in ms
 * @param {number} max - Maximum delay in ms
 * @returns {number} Random delay in ms
 */
const getRandomDelay = (min, max) => Math.random() * (max - min) + min;

/**
 * Simulate human-like typing with random delays and occasional mistakes
 * @param {Page} page - Puppeteer page object
 * @param {string} selector - CSS selector for the input element
 * @param {string} text - Text to type
 * @param {boolean} pressEnter - Whether to press Enter after typing
 */
async function humanType(page, selector, text, pressEnter = false, clearInput = false, fast = false) {
    // Conditionally clear the input if requested
    if (clearInput) {
        try {
            // Try selecting all and deleting (works for inputs and contenteditable)
            await page.click(selector, { clickCount: 3 });
            await page.keyboard.press('Backspace');
        } catch (_) {
            // Fallback: direct value clear and fire events
            await page.evaluate(sel => {
                const input = document.querySelector(sel);
                if (input) {
                    input.focus();
                    if ('value' in input) input.value = '';
                    const evOpts = { bubbles: true, cancelable: true };
                    input.dispatchEvent(new Event('input', evOpts));
                    input.dispatchEvent(new Event('change', evOpts));
                }
            }, selector);
        }
        if (!fast) {
            await wait(getRandomDelay(50, 100));
        }
    }

    // Type per-character with higher delay for slower, human-like typing
    await page.type(selector, String(text), { delay: getRandomDelay(80, 160) });

    // Optionally press Enter
    if (pressEnter) {
        await wait(getRandomDelay(100, 250));
        await page.keyboard.press('Enter');
    }
}

/**
 * Fill an input field with human-like typing
 * @param {Object} req - Express request object
 * @param {Object} req.params - Request parameters
 * @param {string} req.params.sessionId - The session ID
 * @param {Object} req.body - Request body
 * @param {string} req.body.selector - CSS selector for the input element
 * @param {string} req.body.text - Text to type
 * @param {boolean} [req.body.pressEnter=false] - Whether to press Enter after typing
 * @param {Object} res - Express response object
 */
const fillInput = async (req, res) => {
    const { sessionId } = req.params;
    const { selector, text, pressEnter = false, clearInput = true } = req.body;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    if (!selector || text === undefined) {
        return res.status(400).json({
            error: 'Missing required parameters',
            message: 'Both selector and text are required'
        });
    }

    const session = sessions.get(sessionId);
    session.lastActivity = Date.now();
    
    // Ensure we're using the first tab
    const page = await getFirstTab(session);
    session.page = page; // Update the active page in session

    try {
        // Wait for the element to be visible
        await page.waitForSelector(selector, { 
            visible: true, 
            timeout: 10000 
        });
        
        // Scroll the element into view
        await page.evaluate(sel => {
            const element = document.querySelector(sel);
            if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, selector);
        
        // Add a small delay after scrolling
        await new Promise(resolve => setTimeout(resolve, getRandomDelay(50, 150)));
        
        // Type the text with human-like behavior, honoring clearInput flag
        await humanType(page, selector, text, pressEnter, clearInput);

        res.json({
            success: true,
            message: 'Text filled successfully' + (pressEnter ? ' and Enter was pressed' : ''),
            selector,
            textLength: text.length,
            pressEnterPerformed: pressEnter
        });
    } catch (error) {
        console.error(`[${sessionId}] Error filling input:`, error);
        
        res.status(500).json({
            error: 'Failed to fill input',
            message: error.message,
            details: error.stack
        });
    }
};

/**
 * Get the current page content as HTML
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getPageHTML = async (req, res) => {
    const { sessionId } = req.params;
    const { waitFor = 'networkidle0', timeout = 30000 } = req.query;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastActivity = Date.now();

    try {
        // Wait for network to be idle (Puppeteer's way)
        await session.page.waitForNetworkIdle({ idleTime: 500, timeout: parseInt(timeout) });
        
        // Scroll to trigger lazy loading
        await session.page.evaluate(async () => {
            await new Promise(resolve => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    
                    if(totalHeight >= scrollHeight || totalHeight > 2000) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });
        
        // Get the full HTML content after all scripts have executed
        const html = await session.page.content();
        const renderedHTML = await session.page.evaluate(() => document.documentElement.outerHTML);
        // Set content type to text/html
        res.set('Content-Type', 'text/html');
        
        // Send the fully rendered HTML
        res.send(renderedHTML);
    } catch (error) {
        console.error(`[${sessionId}] Error getting page HTML:`, error);
        
        // If we get a timeout, try to get whatever HTML is available
        if (error.name === 'TimeoutError') {
            try {
                const html = await session.page.content();
                res.set('Content-Type', 'text/html');
                return res.send(html);
            } catch (fallbackError) {
                console.error(`[${sessionId}] Fallback HTML retrieval failed:`, fallbackError);
            }
        }
        
        res.status(500).json({
            error: 'Failed to get page HTML',
            message: error.message,
            details: error.stack
        });
    }
};

// Get page content
const getContentSession = async (req, res) => {
    const { sessionId } = req.params;
    const { selector } = req.body;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        let content;
        if (selector) {
            await session.page.waitForSelector(selector, { timeout: 10000 });
            content = await session.page.$eval(selector, el => el.textContent);
        } else {
            content = await session.page.content();
        }

        const pageTitle = await session.page.title();

        res.json({
            success: true,
            sessionId,
            title: pageTitle,
            content
        });
    } catch (error) {
        console.error('Error getting content:', error);
        res.status(500).json({
            error: 'Failed to get content',
            message: error.message
        });
    }
};

// Close session
const closeSession = async (sessionId) => {
    if (sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        try {
            await session.browser.close();
        } catch (error) {
            console.error(`Error closing session ${sessionId}:`, error);
        }
        sessions.delete(sessionId);
    }
};

// Close session endpoint
const closeSessionEndpoint = async (req, res) => {
    const { sessionId } = req.params;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    await closeSession(sessionId);

    res.json({
        success: true,
        message: `Session ${sessionId} closed successfully`
    });
};

// Close all sessions
const closeAllSessions = async (req, res) => {
    const sessionIds = Array.from(sessions.keys());

    for (const sessionId of sessionIds) {
        await closeSession(sessionId);
    }

    res.json({
        success: true,
        message: `Closed ${sessionIds.length} session(s)`,
        count: sessionIds.length
    });
};

// Function to generate random delay
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

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

// Function to simulate human-like typing (legacy version, use the new humanType function instead)
async function simulateHumanTyping(page, selector, text) {
    return new Promise(async (resolve) => {
        const delay = (ms) => new Promise(res => setTimeout(res, ms));
        
        for (const char of text) {
            await page.type(selector, char, { delay: Math.random() * 50 + 50 });
            // Random delay between keystrokes (50-150ms)
            await delay(Math.random() * 100 + 50);
        }
        
        resolve();
    });
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
                                await wait(randomDelay(2000, 5000));
                            }
                            break;
                            
                        case 'IDLE':
                            // Random idle time (simulating reading/thinking)
                            await wait(randomDelay(2000, 10000));
                            break;
                    }
                    
                    // Variable delay between actions (shorter for some actions)
                    const baseDelay = ['TYPING', 'IDLE'].includes(action) 
                        ? randomDelay(500, 1500) 
                        : randomDelay(800, 3000);
                        
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

// Helper function to accept Google cookies
async function acceptGoogleCookies(page) {
    // Common "Accept all" translations in various languages
    const acceptButtonTexts = [
        // English
        'Accept all', 'Accept all cookies', 'Accept all settings', 'Acceptér alle',
        // French
        'Tout accepter', 'Tout accepter et continuer', 'Zaakceptuj wszystko',
        // German
        'Alle akzeptieren', 'Alle Cookies akzeptieren',
        // Spanish
        'Aceptar todo', 'Aceptar todas', 'Aceptar todo y continuar',
        // Italian
        'Accetta tutto', 'Accetta tutto e continua',
        // Portuguese
        'Aceitar tudo', 'Aceitar todos', 'Aceitar todos os cookies',
        // Danish/Norwegian
        'Accepter alle', 'Accepter alle cookies',
        // Swedish
        'Godkänn alla', 'Acceptera alla',
        // Finnish
        'Hyväksy kaikki', 'Hyväksy kaikki evästeet',
        // Dutch
        'Alle accepteren', 'Alles accepteren',
        // Polish
        'Akceptuję wszystkie', 'Akceptuję wszystko',
        // Czech
        'Přijmout vše', 'Přijmout všechny',
        // Hungarian
        'Elfogadom', 'Elfogad mindent', 'Elfogadás', 'Elfogad minden sütit', 
        'Összes elfogadása', 'Elfogadom az összeset', 'Minden süti elfogadása',
        'Elfogadom a sütiket', 'Összes elfogadása és továbblépés', 'Rendben',
        'Elfogad', 'Elfogadok mindent', 'Minden süti elfogadva',
        'Sütik elfogadása', 'Elfogadom a feltételeket', 'Elfogadás és tovább',
        'Az',
        // Slovak
        'Prijať všetko', 'Súhlasím so všetkým',
        // Croatian/Serbian/Bosnian
        'Prihvaćam sve', 'Prihvati sve',
        // Bulgarian
        'Приемам всички', 'Приемам всичко',
        // Russian
        'Принять все', 'Принимаю все',
        // Ukrainian
        'Прийняти всі', 'Погоджуюсь з усім',
        // And more languages as needed...
    ];

    try {
        // Find all buttons that have a direct div child
        const acceptButton = await page.$$eval('button > div', (divs, texts) => {
            // Convert texts to lowercase for case-insensitive comparison
            const lowerTexts = texts.map(t => t.toLowerCase());
            
            // Find the first div whose text content matches any of our target texts
            for (const div of divs) {
                const button = div.closest('button');
                if (button) {
                    const buttonText = div.textContent.trim();
                    if (lowerTexts.includes(buttonText.toLowerCase())) {
                        return {
                            text: buttonText,
                            button: button,
                            buttonId: button.id,
                        };
                    }
                }
            }
            return null;
        }, acceptButtonTexts);

        if (acceptButton) {
            await page.click('#' + acceptButton.buttonId);
            await wait(1000);
            console.log(`Clicked accept button with text: ${acceptButton.text}`);
            return true;

        }

        // If we get here, no matching button was found
        console.log('No matching accept button found');
        return false;
    } catch (error) {
        console.error('Error in acceptGoogleCookies:', error);
        return false;
    }
}

// Function to handle Google validation
const validateGoogle = async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ success: false, error: 'Session not found' });
    }

    try {
        const { page } = session;
        
        // Navigate to Google
        await page.goto('https://www.google.com', { 
            waitUntil: 'networkidle0',
            timeout: 90000 
        });

        // Wait for the page to be fully loaded
        await wait(3000);

        // Try to accept cookies
        const cookiesAccepted = await acceptGoogleCookies(page);

        // Set English as language if possible
        try {
            const langButton = await page.$('button[aria-label*="language"], button[aria-label*="Sprache"]');
            if (langButton) {
                await langButton.click();
                await wait(1000);
                
                // Try to find and click English option
                const englishOption = await page.$('div[role="menuitem"]:has-text("English"), div[role="menuitem"]:has-text("English (United States)")');
                if (englishOption) {
                    await englishOption.click();
                    await wait(2000);
                }
            }
        } catch (e) {
            console.log('Could not change language, continuing...');
        }
    } catch (error) {
        console.error('Error in validateGoogle:', error);
        return res.status(500).json({
            error: 'Failed to validate Google',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

/**
 * Scroll the page to the bottom
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function scrollToBottom(req, res) {
    const { sessionId } = req.params;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    try {
        const page = await getFirstTab(session);
        
        // Scroll to bottom using document.documentElement for better compatibility
        await page.evaluate(() => {
            // Scroll to bottom of the page
            window.scrollTo({
                top: Math.max(
                    document.body.scrollHeight,
                    document.body.offsetHeight,
                    document.documentElement.clientHeight,
                    document.documentElement.scrollHeight,
                    document.documentElement.offsetHeight
                ),
                behavior: 'smooth'
            });
        });

        // Wait for scroll to complete
        await page.waitForFunction(
            'window.scrollY + window.innerHeight >= Math.max(' +
            'document.body.scrollHeight, ' +
            'document.body.offsetHeight, ' +
            'document.documentElement.clientHeight, ' +
            'document.documentElement.scrollHeight, ' +
            'document.documentElement.offsetHeight' +
            ') - 10', // Allow 10px tolerance
            { timeout: 5000 }
        );

        res.json({ 
            success: true, 
            message: 'Page scrolled to bottom',
            position: await page.evaluate(() => ({
                scrollY: window.scrollY,
                innerHeight: window.innerHeight,
                scrollHeight: document.body.scrollHeight
            }))
        });
    } catch (error) {
        console.error(`Error scrolling to bottom in session ${sessionId}:`, error);
        res.status(500).json({ 
            error: 'Failed to scroll to bottom',
            details: error.message 
        });
    }
}

/**
 * Refresh the active page in a session
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const refreshSession = async (req, res) => {
    const { sessionId } = req.params;
    const { waitUntil = 'domcontentloaded', timeout = 30000 } = req.body;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        const { page } = session;

        if (!page) {
            return res.status(400).json({
                error: 'No active page found',
                message: 'Session exists but no active page is available'
            });
        }

        console.log(`Refreshing page in session ${sessionId}`);

        // Reload the page with specified options
        await page.reload({
            waitUntil,
            timeout
        });

        // Get updated page information
        const pageTitle = await page.title();
        const pageUrl = page.url();

        res.json({
            success: true,
            sessionId,
            message: 'Page refreshed successfully',
            pageInfo: {
                title: pageTitle,
                url: pageUrl,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error(`Error refreshing page in session ${sessionId}:`, error);
        res.status(500).json({
            error: 'Failed to refresh page',
            message: error.message
        });
    }
};

module.exports = {
    createSession,
    listSessions,
    getSession,
    scrollToBottom,
    getPageHTML,
    navigateSession,
    closeSessionEndpoint,
    closeAllSessions,
    screenshotSession,
    executeScriptSession,
    clickSession,
    typeSession,
    getContentSession,
    simulateUserActions,
    validateGoogle,
    fillInput,
    checkXPath,
    configure2CaptchaEndpoint,
    validate2CaptchaEndpoint,
    diagnose2CaptchaEndpoint,
    solveRecaptchaEndpoint,
    refreshSession
};
