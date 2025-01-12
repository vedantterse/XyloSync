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

// Update authMiddleware to be more permissive during development
async function authMiddleware(req, res, next) {
    try {
        // Skip auth check for development if enabled
        if (process.env.SKIP_AUTH === 'true') {
            return next();
        }

        // Check for authenticated cookie first
        if (req.cookies.authenticated === 'true') {
            return next();
        }

        const token = req.headers.authorization?.split(' ')[1];
        
        // For page requests without token, redirect to index
        if (!req.path.startsWith('/api/') && !token) {
            return res.redirect('/');
        }

        // For API requests without token, return JSON error
        if (req.path.startsWith('/api/') && !token) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }

        // If we have a token, verify it
        if (token) {
            try {
                const response = await fetch(`${process.env.CLERK_API_URL}/sessions/${token}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${process.env.CLERK_SECRET_KEY}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (response.ok) {
                    return next();
                }

                // Token verification failed
                if (req.path.startsWith('/api/')) {
                    return res.status(401).json({ success: false, message: 'Invalid token' });
                } else {
                    return res.redirect('/');
                }
            } catch (error) {
                console.error('Token verification error:', error);
                if (req.path.startsWith('/api/')) {
                    return res.status(500).json({ success: false, message: 'Authentication error' });
                } else {
                    return res.redirect('/');
                }
            }
        }

        // If we get here with no token, redirect or return error
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        } else {
            return res.redirect('/');
        }
    } catch (error) {
        console.error('Auth error:', error);
        if (req.path.startsWith('/api/')) {
            return res.status(500).json({ success: false, message: 'Authentication error' });
        } else {
            return res.redirect('/');
        }
    }
}

// Update route middleware to only check authentication
app.use(['/homepage', '/fetch-files', '/upload', '/delete', '/download'], authMiddleware);

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
app.get('/', async (req, res) => {
    if (req.cookies.authenticated === 'true') {
        res.redirect('/homepage');
    } else {
        res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    }
});

app.get('/homepage', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/homepage.html'));
});

// Create a single instance of RoomManager
const roomManager = new RoomManager(supabase);

// Fetch existing files from Supabase Storage with pagination
app.get('/fetch-files', authMiddleware, async (req, res) => {
    const folder = req.query.folder || '';
    try {
        const { data: files, error } = await supabase.storage
            .from('uploads')
            .list(folder, {
                sortBy: { column: 'created_at', order: 'desc' }
            });

        if (error) throw error;

        if (!files) {
            return res.json({ success: true, files: [] });
        }

        const fileList = files
            .filter(file => file.name !== '.folder')
            .map(file => ({
                fileName: `${folder}/${file.name}`,
                size: file.metadata?.size || 0,
                contentType: file.metadata?.mimetype || 'application/octet-stream',
                timeCreated: file.created_at || new Date().toISOString()
            }));

        res.json({ success: true, files: fileList });
    } catch (error) {
        console.error('Error fetching files:', error);
        res.status(500).json({ success: false, message: 'Error fetching files: ' + error.message });
    }
});

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

// Check authentication status
app.get('/check-auth', (req, res) => {
    res.json({ authenticated: !!req.cookies.authenticated });
});

// Add a logout route
app.get('/logout', (req, res) => {
    res.clearCookie('authenticated');
    res.redirect('/');
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

// Room management routes
app.get('/api/rooms/user/:username', authMiddleware, async (req, res) => {
    try {
        const username = req.params.username;
        const rooms = await roomManager.getUserRooms(username);
        console.log('Sending rooms for user:', username, rooms);
        res.json({ success: true, rooms });
    } catch (error) {
        console.error('Error getting user rooms:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/room/create', authMiddleware, async (req, res) => {
    try {
        const username = req.headers['x-user-id'];
        if (!username) {
            throw new Error('Username is required');
        }

        const roomData = await roomManager.createRoom(username);
        console.log('Created room:', roomData); // Debug log
        res.json(roomData);
    } catch (error) {
        console.error('Error creating room:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/room/join/:code', authMiddleware, async (req, res) => {
    try {
        const roomCode = req.params.code;
        console.log('Joining room:', roomCode); // Debug log
        const result = await roomManager.joinRoom(roomCode);
        console.log('Join result:', result); // Debug log
        res.json(result);
    } catch (error) {
        console.error('Error joining room:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update the delete room endpoint
app.delete('/api/room/:code', authMiddleware, async (req, res) => {
    try {
        const roomCode = req.params.code;
        console.log('Deleting room:', roomCode);
        
        // Get room data before deletion
        const { data, error } = await supabase.storage
            .from('uploads')
            .list('');

        if (error) throw error;

        const roomFolder = data.find(item => item.name.includes(`_${roomCode}`));
        if (!roomFolder) {
            return res.status(404).json({ success: false, message: 'Room not found' });
        }

        // Delete the room
        const result = await roomManager.deleteRoom(roomCode);

        // Broadcast to all connected clients that the room is deleted
        io.emit('roomDeleted', { roomCode });
        
        res.json(result);
    } catch (error) {
        console.error('Error deleting room:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Failed to delete room' 
        });
    }
});

// Update file fetch endpoint
app.get('/api/files/:folderPath(*)', authMiddleware, async (req, res) => {
    try {
        // Clean the folder path
        const folderPath = req.params.folderPath.replace(/^uploads\//, '');
        console.log('Fetching files from clean path:', folderPath);

        const { data, error } = await supabase.storage
            .from('uploads')
            .list(folderPath);

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.json({ success: true, files: [] });
        }

        // Use clean paths in response
        const files = await Promise.all(
            data.filter(file => !file.name.startsWith('.'))
                .map(async (file) => {
                    const { data: urlData } = supabase.storage
                        .from('uploads')
                        .getPublicUrl(`${folderPath}/${file.name}`);

                    return {
                        name: file.name,
                        path: `${folderPath}/${file.name}`, // Using clean path
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

// Simplify the delete endpoint - remove ownership check
app.delete('/delete/:filePath(*)', authMiddleware, async (req, res) => {
    try {
        // Clean the folder path by removing any 'uploads/' prefix
        const filePath = req.params.filePath.replace(/^uploads\//, '');
        console.log('Deleting file from path:', filePath);

        const { error: deleteError } = await supabase.storage
            .from('uploads')
            .remove([filePath]);

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