process.removeAllListeners('warning');
process.on('warning', (warning) => {
    if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
        return;
    }
    console.warn(warning);
});

import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { emailServerHandler } from './email-server.js';
import { createClient } from '@supabase/supabase-js';
import { RoomManager } from './room.js';
import session from 'express-session';
import MemoryStore from 'memorystore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Supabase initialization using environment variables
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Add after Supabase initialization
async function initializeStorage() {
    try {
        // Check if bucket exists
        const { data: buckets } = await supabase
            .storage
            .listBuckets();
        
        const uploadsBucket = buckets.find(b => b.name === 'uploads');
        
        if (!uploadsBucket) {
            // Create uploads bucket if it doesn't exist
            const { data, error } = await supabase
                .storage
                .createBucket('uploads', {
                    public: true,
                    fileSizeLimit: 4500000 // 4.5MB
                });
            
            if (error) throw error;
            console.log('Created uploads bucket');
        }
        
        console.log('Storage initialized successfully');
    } catch (error) {
        console.error('Error initializing storage:', error);
    }
}

// Call initialization
initializeStorage();

const app = express();
const httpServer = createServer(app);

// Session Configuration
const MStore = MemoryStore(session);
app.use(session({
    store: new MStore({
        checkPeriod: 86400000 // Prune expired entries every 24h
    }),
    secret: process.env.SESSION_SECRET || 'a-very-strong-secret-key-that-is-long-and-random',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 365 * 24 * 60 * 60 * 1000, // Persist session for 1 year
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true
    }
}));

// Basic CORS configuration
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Clerk configuration  
app.get('/api/clerk-config', (req, res) => {
    if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.NEXT_PUBLIC_CLERK_FRONTEND_API) {
        return res.status(500).json({ 
            error: 'Clerk configuration not found in environment variables' 
        });
    }
    res.json({
        publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
        frontendApi: process.env.NEXT_PUBLIC_CLERK_FRONTEND_API
    });
});

// Initialize Socket.IO with basic configuration
const io = new Server(httpServer, {
    cors: {
        origin: process.env.NODE_ENV === 'production' 
            ? 'https://xylosync.vercel.app' 
            : 'http://localhost:3000',
        methods: ['GET', 'POST']
    },
    transports: ['websocket'],
    pingTimeout: 60000
});

// Add socket.io middleware for authentication
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error'));
    }
    // Add your token verification logic here if needed
    next();
});

// Handle socket connections
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });

    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });
});

// Store io instance in app for access from routes
app.set('io', io);

const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Small helper for consistent cookie options
function setIdentityCookies(res, { userId, username }) {
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    const cookieOpts = {
        maxAge: oneYearMs,
        httpOnly: false,          // allow client-side read if ever needed
        sameSite: 'Lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/'
    };
    res.cookie('xy_user_id', userId, cookieOpts);
    res.cookie('xy_username', username, cookieOpts);
}

// Session-based Authentication Middleware
async function authMiddleware(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    // Try to seed session from cookies
    const cookieUserId = req.cookies.xy_user_id;
    const cookieUsername = req.cookies.xy_username;
    if (cookieUserId) {
        req.session.user = { userId: cookieUserId, username: cookieUsername || `User${Math.floor(1000 + Math.random() * 9000)}` };
        return req.session.save(err => {
            if (err) {
                console.error('Session save error (seed from cookies):', err);
                return res.status(500).json({ success: false, message: 'Could not create session.' });
            }
            next();
        });
    }

    // Create anonymous user session once and persist in cookie
    const randomWords = ["Cosmic", "Stellar", "Quantum", "Astro", "Nova", "Cyber", "Tech", "Future"];
    const randomName = `${randomWords[Math.floor(Math.random() * randomWords.length)]}${Math.floor(1000 + Math.random() * 9000)}`;
    const userId = uuidv4();
    req.session.user = { userId, username: randomName };
    req.session.save(err => {
        if (err) {
            console.error('Session save error:', err);
            return res.status(500).json({ success: false, message: 'Could not create session.' });
        }
        setIdentityCookies(res, { userId, username: randomName });
        next();
    });
}

// Session endpoint
app.get('/api/session', (req, res) => {
    // If session already exists
    if (req.session && req.session.user) {
        return res.json({
            success: true,
            authenticated: true,
            username: req.session.user.username,
            userId: req.session.user.userId
        });
    }

    // Seed from cookies if available
    const cookieUserId = req.cookies.xy_user_id;
    const cookieUsername = req.cookies.xy_username;
    if (cookieUserId) {
        req.session.user = {
            userId: cookieUserId,
            username: cookieUsername || `User${Math.floor(1000 + Math.random() * 9000)}`
        };
        return req.session.save(err => {
            if (err) {
                return res.status(500).json({ success: false, authenticated: false });
            }
            return res.json({
                success: true,
                authenticated: true,
                username: req.session.user.username,
                userId: req.session.user.userId
            });
        });
    }

    // Function to generate a cool random username
    function generateUsername() {
        const adjectives = [
            "Cosmic", "Stellar", "Quantum", "Astro", "Nova", "Cyber", "Tech", "Future",
            "Lunar", "Solar", "Nebula", "Eclipse", "Galactic", "Hyper", "Neon", "Retro",
            "Pixel", "Shadow", "Alpha", "Omega", "Binary", "Virtual", "Meta", "Warp",
            "Turbo", "Nano", "Core", "Vortex", "Asteroid", "Orbit", "Zenith", "Pulse",
            "Matrix", "Cybernetic", "Spectral", "Infra", "Ultra", "Prism", "Flux", "Drift"
        ];

        const nouns = [
            "Rider", "Hunter", "Walker", "Runner", "Pilot", "Hacker", "Bot", "Agent",
            "Guardian", "Seeker", "Breaker", "Forge", "Storm", "Light", "Blaze", "Cipher",
            "Blade", "Drone", "Nova", "Shadow", "Sentinel", "Star", "Flux", "Core",
            "Pulse", "Phantom", "Wave", "Vortex", "Orbit", "Astro", "Nebula", "Comet",
            "Rocket", "Phoenix", "Galaxy", "Specter", "Rogue", "Titan", "Quantum"
        ];

        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        const number = Math.floor(1000 + Math.random() * 9000);
        return `${adj}${noun}${number}`;
    }

    // Create a new identity (first visit)
    const randomName = generateUsername();
    const userId = uuidv4();

    req.session.user = { userId, username: randomName };
    req.session.save(err => {
        if (err) {
            return res.status(500).json({ success: false, authenticated: false });
        }
        setIdentityCookies(res, { userId, username: randomName });
        res.json({
            success: true,
            authenticated: true,
            username: req.session.user.username,
            userId: req.session.user.userId
        });
    });
});

// Apply auth middleware to protected routes
app.use(
    [
        '/homepage',
        // '/fetch-files', // removed
        '/upload',
        '/delete',
        '/download',
        '/api/rooms/user',
        '/api/room/create',
        '/api/room/join',
        '/api/room/:code',
        '/api/files/:folderPath(*)'
    ],
    authMiddleware
);

// Serve the maintenance page

// Move this middleware BEFORE your route handlers
app.use((req, res, next) => {
    if (req.path.endsWith('.html')) {
        const cleanPath = req.path.slice(0, -5); // Remove .html
        return res.redirect(301, cleanPath);
    }
    next();
});

// Then your existing routes
app.get('/', (req, res) => {
    // Always serve the index page - let users choose rooms from there
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/homepage', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/homepage.html'));
});

// Create a single instance of RoomManager
const roomManager = new RoomManager(supabase);

// Handle file uploads
app.post('/upload', [authMiddleware, upload.single('file')], async (req, res) => {
    console.log('Upload request received');
    
    try {
        const file = req.file;
        // Clean the folder path by removing any 'uploads/' prefix
        const folderPath = req.body.folderPath.replace(/^uploads\//, '');

        if (!file || !folderPath) {
            throw new Error('File and folder path are required');
        }

        // Extract room code from folder path
        const roomCode = folderPath.split('_')[1]?.split('/')[0];
        if (!roomCode) {
            throw new Error('Invalid folder path format');
        }

        // Check if room exists
        const { data: folders, error: listError } = await supabase.storage
            .from('uploads')
            .list('');

        if (listError) throw listError;

        const roomExists = folders.some(item => item.name.includes(`_${roomCode}`));
        if (!roomExists) {
            return res.status(404).json({ 
                success: false, 
                message: 'Room not found or has been deleted',
                redirect: '/homepage'
            });
        }

        console.log('Uploading to clean path:', folderPath); // Debug log

        // Upload to Supabase with clean path
        const { data, error } = await supabase.storage
            .from('uploads')
            .upload(`${folderPath}/${file.originalname}`, file.buffer, {
                contentType: file.mimetype,
                upsert: true
            });

        if (error) {
            console.error('Supabase upload error:', error);
            throw error;
        }

        // Get public URL with clean path
        const { data: urlData } = supabase.storage
            .from('uploads')
            .getPublicUrl(`${folderPath}/${file.originalname}`);

        const fileInfo = {
            name: file.originalname,
            path: `${folderPath}/${file.originalname}`, // Using clean path
            url: urlData.publicUrl,
            type: file.mimetype,
            size: file.size
        };

        console.log('File uploaded successfully:', fileInfo);
        res.json({ success: true, file: fileInfo });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Logout Route
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).send('Could not log out.');
        }
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});


// Add the email endpoint
const emailUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB max per file
        files: 10 // Max 10 files
    }
});

app.use('/send-email', (req, res, next) => {
    const userAgent = req.headers['user-agent'];
    if (/iPhone|iPad|iPod|Android/i.test(userAgent)) {
        return res.status(403).json({ 
            error: 'Email service is not available on mobile devices' 
        });
    }
    next();
});

app.post('/send-email', emailUpload.array('files'), emailServerHandler);

// Room management routes - use session (no username in path)
app.get('/api/rooms/user', authMiddleware, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const rooms = await roomManager.getUserRooms(userId);
        res.json({ success: true, rooms });
    } catch (error) {
        console.error('Error getting user rooms:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/room/create', authMiddleware, async (req, res) => {
    try {
        const { username, userId } = req.session.user;
        if (!username || !userId) throw new Error('User identifier not found in session');
        const roomData = await roomManager.createRoom(username, userId);
        // roomManager.createRoom returns { success, roomCode, folderPath, owner }
        res.json(roomData);
    } catch (error) {
        console.error('Error creating room:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/room/join/:code', authMiddleware, async (req, res) => {
    try {
        const roomCode = req.params.code;
        const result = await roomManager.joinRoom(roomCode);
        // result includes owner username from .meta.json
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Error joining room:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update the delete room endpoint
app.delete('/api/room/:code', async (req, res) => {
    try {
        const roomCode = req.params.code;
        const userId = req.session.user.userId;
        const result = await roomManager.deleteRoom(roomCode, userId);
        
        // Broadcast to all connected clients that the room is deleted
        io.emit('roomDeleted', { roomCode });
        
        res.json(result);
    } catch (error) {
        console.error('Error deleting room:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update file fetch endpoint (unchanged signature)
app.get('/api/files/:folderPath(*)', authMiddleware, async (req, res) => {
    try {
        const folderPath = req.params.folderPath.replace(/^uploads\//, '');
        
        const { data, error } = await supabase.storage
            .from('uploads')
            .list(folderPath);

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.json({ success: true, files: [] });
        }

        const files = await Promise.all(
            data.filter(file => !file.name.startsWith('.'))
                .map(async (file) => {
                    const { data: urlData } = supabase.storage
                        .from('uploads')
                        .getPublicUrl(`${folderPath}/${file.name}`);

                    return {
                        name: file.name,
                        path: `${folderPath}/${file.name}`,
                        url: urlData.publicUrl,
                        type: file.metadata?.mimetype || 'application/octet-stream',
                        size: file.metadata?.size || 0
                    };
                })
        );

        res.json({ success: true, files });
    } catch (error) {
        console.error('Error fetching files:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Enforce owner-only deletion
app.delete('/delete/:filePath(*)', authMiddleware, async (req, res) => {
    try {
        // filePath may include uploads/ prefix, normalize
        const raw = req.params.filePath.replace(/^uploads\//, '');
        // ownerId is the prefix before first '_' in folder segment
        const ownerId = raw.split('/')[0].split('_')[0];
        if (ownerId !== req.session.user.userId) {
            return res.status(403).json({ success: false, message: 'You are not the owner of this file.' });
        }

        const { error: deleteError } = await supabase.storage.from('uploads').remove([raw]);
        if (deleteError) throw deleteError;

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Add file download endpoint
app.get('/download/:filePath(*)', authMiddleware, async (req, res) => {
    try {
        const filePath = req.params.filePath;
        console.log('Downloading file:', filePath);

        // Get the file from Supabase
        const { data, error } = await supabase.storage
            .from('uploads')
            .download(filePath);

        if (error) throw error;

        // Set appropriate headers for download
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
        
        // Send the file data
        res.send(data);
    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Start the server
httpServer.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});

export default app;