require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const browserRoutes = require('./routes/browserRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const { getBrowser, closeBrowser } = require('./controllers/browserController');

const app = express();
const PORT = process.env.PORT || 3000;

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing browser...');
    await closeBrowser();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, closing browser...');
    await closeBrowser();
    process.exit(0);
});

// Security middleware
app.use(helmet());
app.use(cors());

// Logging middleware
app.use(morgan('combined'));

// Body parser middleware with increased limit for image uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting (optional - uncomment to enable)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
// app.use('/api', limiter);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api', browserRoutes);
app.use('/api/session', sessionRoutes);

// Restart endpoint
app.post('/api/restart', (req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`Restart requested at: ${timestamp} by IP: ${req.ip}`);
    
    // Send response immediately before restarting
    res.json({ 
        success: true, 
        message: 'Server restart initiated',
        timestamp: timestamp
    });
    
    // Use a small delay to ensure the response is sent
    setTimeout(() => {
        console.log('Cleaning up /tmp/ directory...');
        const { exec } = require('child_process');
        
        // First, clean up the /tmp/ directory
        // Use find + xargs to handle the case when /tmp/ is empty
        exec('find /tmp/ -mindepth 1 -delete 2>/dev/null || true', (cleanupError, cleanupStdout, cleanupStderr) => {
            if (cleanupError) {
                console.error('Error cleaning /tmp/ directory:', cleanupError);
            } else {
                console.log('Successfully cleaned /tmp/ directory');
                if (cleanupStdout) console.log('Cleanup output:', cleanupStdout);
                if (cleanupStderr) console.error('Cleanup stderr:', cleanupStderr);
            }
            
            // Then proceed with the restart
            console.log('Initiating server restart...');
            const pm2ProcessName = process.env.PM2_APP_NAME || 'browser-api';
            
            exec(`pm2 restart ${pm2ProcessName} --update-env`, (restartError, stdout, stderr) => {
                if (restartError) {
                    console.error('Restart error:', restartError);
                    return;
                }
                console.log('Restart output:', stdout);
                if (stderr) {
                    console.error('Restart stderr:', stderr);
                }
            });
        });
    }, 100);
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(err.status || 500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Start server
app.listen(PORT, async () => {
    console.log(`API is running at http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

    // Pre-initialize browser
    try {
        await getBrowser();
        console.log('Browser initialized');
    } catch (error) {
        console.error('Browser pre-initialization failed:', error.message);
        console.error('Browser will be initialized on the next browser API request.');
    }
});
