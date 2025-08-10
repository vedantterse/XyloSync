// Global variable to hold user info for the current page session
let currentUser = null;
let socket = null;

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/js/sw.js')
            .then(registration => {
                console.log('ServiceWorker registered');
            })
            .catch(err => {
                console.log('ServiceWorker registration failed:', err);
            });
    });
}

// Function to fetch session and initialize the page
async function initializeApp() {
    try {
        // Prefer already-cached identity for instant UI consistency across tabs
        const cached = localStorage.getItem('currentUser');
        if (cached) {
            try { currentUser = JSON.parse(cached); } catch { /* ignore parse errors */ }
        }

        const response = await fetch('/api/session', { credentials: 'include' });
        const data = await response.json();
        if (data.authenticated && data.username) {
            currentUser = { username: data.username, userId: data.userId };
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            if (window.location.pathname.includes('homepage')) {
                updateHomePageUI();
                await fetchFiles();
            }
        } else {
            window.location.href = '/';
        }
    } catch (error) {
        console.error('Initialization failed:', error);
        window.location.href = '/';
    }
}

function updateHomePageUI() {
    if (!currentUser) return;

    const roomData = JSON.parse(localStorage.getItem('currentRoom'));
    const roomCodeElement = document.getElementById('currentRoomCode');
    const roomOwnerElement = document.getElementById('roomOwner');

    if (roomData) {
        if (roomCodeElement) roomCodeElement.textContent = roomData.roomCode;
        if (roomOwnerElement) roomOwnerElement.textContent = roomData.owner;
    }
}

// DOM elements
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const fileDisplay = document.getElementById('fileDisplay');

// IMPORTANT: Add this debug log
console.log('Initial elements:', { uploadBtn, fileInput });

// Remove any existing listeners and create fresh button
if (uploadBtn) {
    // Debug click handling
    uploadBtn.addEventListener('click', function(e) {
        console.log('Raw button click detected'); // Debug log
    });

    // Main click handler
    uploadBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Upload button clicked'); // Debug log
        
        try {
            const roomData = JSON.parse(localStorage.getItem('currentRoom'));
            if (!roomData?.folderPath) {
                alert('Please join or create a room first');
                return;
            }
            
            // Directly trigger file input
            if (fileInput) {
                console.log('Triggering file input click'); // Debug log
                fileInput.click();
            } else {
                console.error('File input not found');
            }
        } catch (error) {
            console.error('Upload error:', error);
        }
    };

    // Add direct mousedown handler
    uploadBtn.onmousedown = (e) => {
        console.log('Button mousedown detected'); // Debug log
        e.preventDefault();
        e.stopPropagation();
    };

    // Add mobile touch handler
    uploadBtn.ontouchend = (e) => {
        console.log('Touch event detected'); // Debug log
        e.preventDefault();
        e.stopPropagation();
        uploadBtn.click();
    };
}

// File input handler - keep this simple
if (fileInput) {
    fileInput.onchange = async (event) => {
        console.log('File input change detected'); // Debug log
        event.preventDefault();
        const files = event.target.files;
        if (files.length > 0) {
            await handleFiles(files);
            fileInput.value = '';
        }
    };
}

// Determine the Socket.IO server URL based on the environment
const currentDomain = window.location.hostname;
const socketURL = currentDomain === 'localhost' || currentDomain.includes('ngrok')
    ? window.location.origin  
    : `https://${currentDomain}`;

console.log('Connecting to Socket.IO server at:', socketURL);

// Initialize WebSocket
function initializeWebSocket() {
    if (socket) return;
    
    try {
        socket = io({
            transports: ['websocket'],
            upgrade: false,
            reconnection: true,
            reconnectionAttempts: 5,
            timeout: 10000
        });
        
        socket.on('connect', () => {
            console.log('WebSocket connected');
            isConnected = true;
        });

        socket.on('connect_error', (error) => {
            console.error('WebSocket connection error:', error);
            isConnected = false;
        });

        socket.on('disconnect', () => {
            console.log('Disconnected from server');
            isConnected = false;
        });

        socket.on('roomDeleted', ({ roomCode }) => {
            const currentRoom = JSON.parse(localStorage.getItem('currentRoom'));
            if (currentRoom?.roomCode === roomCode) {
                localStorage.removeItem('currentRoom');
                showNotification('Room was deleted', 'warning');
                window.location.href = '/';
            }
        });
    } catch (error) {
        console.error('Socket initialization error:', error);
    }
}

// Room Management System
class RoomManagerUI {
    constructor() {
        this.activeModal = null;
    }

    async showRoomManager() {
        try {
            if (!currentUser?.userId) throw new Error('User not authenticated');

            const response = await fetch('/api/rooms/user', { credentials: 'include' });
            const data = await response.json();
            if (!data.success) throw new Error(data.message);

            // Create modal
            const modal = document.createElement('div');
            modal.className = 'room-manager-overlay';
            modal.innerHTML = `
                <div class="room-manager-modal">
                    <div class="room-manager-header">
                        <h2>Your Rooms</h2>
                        <p>${data.rooms.length} of 3 rooms used</p>
                    </div>
                    <div class="room-list">
                        ${data.rooms.length === 0 ? `
                            <div class="no-rooms-message">
                                You haven't created any rooms yet.
                            </div>
                        ` : data.rooms.map(room => `
                            <div class="room-item">
                                <div class="room-info">
                                    <div class="room-code">${room.roomCode}</div>
                                </div>
                                <div class="room-actions">
                                    <button class="room-btn join-btn" data-code="${room.roomCode}">Join</button>
                                    <button class="room-btn delete-btn" data-code="${room.roomCode}">Delete</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    ${data.rooms.length < 3 ? `
                        <button class="create-new-btn">Create New Room</button>
                    ` : `
                        <div class="limit-reached-message">
                            Maximum room limit reached (3). Please delete a room to create a new one.
                        </div>
                    `}
                </div>
            `;

            // Remove any existing modal
            if (this.activeModal) {
                this.activeModal.remove();
            }

            document.body.appendChild(modal);
            this.activeModal = modal;
            this.attachEventHandlers(modal);
            
            setTimeout(() => modal.classList.add('active'), 10);
        } catch (error) {
            console.error('Error showing room manager:', error);
            showNotification(error.message, 'error');
        }
    }

    attachEventHandlers(modal) {
        // Close modal when clicking outside
        modal.addEventListener('click', e => {
            if (e.target === modal) {
                modal.classList.remove('active');
                setTimeout(() => modal.remove(), 300);
            }
        });

        // Create room button
        const createBtn = modal.querySelector('.create-new-btn');
        if (createBtn) {
            createBtn.addEventListener('click', async () => {
                try {
                    if (!currentUser?.username) {
                        throw new Error('User not authenticated');
                    }

                    const response = await fetch('/api/room/create', {
                        method: 'POST',
                        credentials: 'include'
                    });

                    const data = await response.json();
                    if (!data.success) {
                        throw new Error(data.message);
                    }
                    modal.remove();
                    localStorage.setItem('currentRoom', JSON.stringify(data));
                    window.location.href = '/homepage';
                } catch (error) {
                    console.error('Error creating room:', error);
                    showNotification(error.message, 'error');
                }
            });
        }

        // Join and delete buttons
        modal.querySelectorAll('.join-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await joinRoom(btn.dataset.code);
                } catch (error) {
                    showNotification(error.message, 'error');
                }
            });
        });

        modal.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const roomCode = btn.dataset.code;
                if (confirm('Are you sure you want to delete this room? This cannot be undone.')) {
                    try {
                        await deleteRoom(roomCode);
                        modal.classList.remove('active');
                        setTimeout(() => modal.remove(), 300);
                    } catch (error) {
                        showNotification(error.message, 'error');
                    }
                }
            });
        });
    }
}

// Create Room - make sure this works on index page
document.querySelector('.create-room')?.addEventListener('click', async () => {
    if (!currentUser) {
        await initializeApp();
    }

    try {
        const roomManagerUI = new RoomManagerUI();
        await roomManagerUI.showRoomManager();
    } catch (err) {
        console.error('Error in room flow:', err);
        showNotification(err.message || 'Failed to process room operation', 'error');
    }
});

// Join Room - works on index page with modal
document.querySelector('.join-room')?.addEventListener('click', async () => {
    if (!currentUser) {
        await initializeApp();
    }

    const modal = document.getElementById('joinRoomModal');
    if (modal) {
        modal.style.display = 'block';
        requestAnimationFrame(() => modal.classList.add('active'));
    }
});

// Close modal
document.querySelector('.close-btn').addEventListener('click', () => {
    const modal = document.getElementById('joinRoomModal');
    modal.classList.remove('active');
    // Hide modal after animation completes
    setTimeout(() => modal.style.display = 'none', 300);
});

// Join room on enter key or button click
const handleJoinRoom = async (event) => {
    if (event.type === 'keypress' && event.key !== 'Enter') return;
    
    event.preventDefault();
    try {
        if (!currentUser) {
            await initializeApp();
        }

        const code = document.getElementById('roomCodeInput').value.trim();
        if (code.length === 5) {
            await joinRoom(code);
            const modal = document.getElementById('joinRoomModal');
            modal.classList.remove('active');
            setTimeout(() => {
                modal.style.display = 'none';
                document.getElementById('roomCodeInput').value = '';
            }, 300);
        } else {
            showNotification('Please enter a valid 5-digit code', 'error');
        }
    } catch (error) {
        console.error('Error joining room:', error);
        showNotification(error.message, 'error');
    }
};

document.getElementById('roomCodeInput').addEventListener('keypress', handleJoinRoom);
document.getElementById('joinRoomBtn').addEventListener('click', handleJoinRoom);

document.getElementById('joinRoomModal').addEventListener('click', (e) => {
    if (e.target.id === 'joinRoomModal') {
        const modal = document.getElementById('joinRoomModal');
        modal.classList.remove('active');
        setTimeout(() => modal.style.display = 'none', 300);
    }
});


// Initialize room manager globally
const roomManager = new RoomManagerUI();

// Update createRoom function to use the room manager
async function createRoom() {
    try {
        const userInfo = JSON.parse(localStorage.getItem('userInfo'));
        if (!userInfo?.username) {
            throw new Error('User not authenticated');
        }
        await roomManager.showRoomManager();
    } catch (error) {
        console.error('Error in room creation flow:', error);
        alert(error.message);
    }
}

// Update the WebSocket initialization
function initializeWebSocket() {
    if (socket) return; // Prevent multiple initializations
    
    try {
        socket = io({
            transports: ['websocket'],
            upgrade: false,
            reconnection: true,
            reconnectionAttempts: 5,
            timeout: 10000
        });
        
        socket.on('connect', () => {
            console.log('WebSocket connected');
        });

        socket.on('connect_error', (error) => {
            console.error('WebSocket connection error:', error);
        });
        
        socket.on('roomUpdate', async (data) => {
            const userInfo = JSON.parse(localStorage.getItem('userInfo'));
            if (data.username === userInfo?.username) {
                await refreshRoomManager();
            }
        });

        // Handle room deletion notification
        socket.on('roomDeleted', ({ roomCode }) => {
            const currentRoom = JSON.parse(localStorage.getItem('currentRoom'));
            if (currentRoom && currentRoom.roomCode === roomCode) {
                // Clear room data
                localStorage.removeItem('currentRoom');
                showNotification('This room has been deleted by the owner', 'warning');
                // Redirect to index page
                window.location.href = '/';
            }
        });
    } catch (error) {
        console.error('Error initializing WebSocket:', error);
    }
}

// Add better connection state logging
let isConnected = false;

// Guard these listeners so homepage doesn't crash before socket is initialized
if (socket && typeof socket.on === 'function') {
    socket.on('connect', () => {
        console.log('Connected to server:', socketURL);
        isConnected = true;
        checkXyloMailState && checkXyloMailState();
    });

    socket.on('connect_error', (error) => {
        console.log('Connection error to', socketURL, ':', error.message);
        isConnected = false;
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server:', socketURL);
        isConnected = false;
    });
}

// Remove any click event listeners that might have been added before
if (uploadBtn) {
    const clonedBtn = uploadBtn.cloneNode(true);
    if (uploadBtn.parentNode) {
        uploadBtn.parentNode.replaceChild(clonedBtn, uploadBtn);
    }
    // Get the new button reference after cloning
    const newUploadBtn = document.getElementById('uploadBtn');
    if (newUploadBtn) {
        // Single click handler for the upload button
        newUploadBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const permissions = await checkPermissions();
            if (!permissions.includes('upload')) {
                alert('Access denied for file upload');
                return;
            }
            if (fileInput) fileInput.click();
        });
    }
}


// Function to check user's permissions
async function checkPermissions() {
    return ['fetch', 'download', 'upload', 'delete'];
}

// Function to get active session token
async function getAuthToken() {
    return 'session-based-token';
}

// Update uploadFile function to check room existence
async function uploadFile(file) {
    try {
        const roomData = JSON.parse(localStorage.getItem('currentRoom'));
        if (!roomData?.folderPath) {
            throw new Error('No active room');
        }

        // Create FormData and append file
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folderPath', roomData.folderPath);

        const response = await fetch('/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${await getAuthToken()}`
            },
            body: formData
        });

        const data = await response.json();
        
        if (response.status === 404) {
            // Room not found or deleted
            localStorage.removeItem('currentRoom');
            showNotification('This room has been deleted', 'error');
            window.location.href = '/';
            return;
        }

        if (!data.success) {
            throw new Error(data.message || 'Upload failed');
        }

        return data.file;
    } catch (error) {
        console.error('Upload error:', error);
        showNotification(error.message, 'error');
        throw error;
    }
}

// Function to display file with proper owner check and old UI
async function displayFile(file, url, fileName) {
    try {
        // Get current room data and user info
        const roomData = JSON.parse(localStorage.getItem('currentRoom'));
        if (!roomData || !currentUser) return;

        // Skip if this file is already rendered (prevents temporary duplicates)
        if (document.querySelector(`.file-container[data-filename="${fileName}"]`)) {
            return;
        }

        const ownerId = roomData.folderPath.split('/')[1].split('_')[0];
        const isOwner = currentUser.userId === ownerId;

        const fileContainer = document.createElement('div');
        fileContainer.className = 'file-container';
        fileContainer.setAttribute('data-filename', fileName);

        // Determine file type and icon
        const fileType = file.type || getFileTypeFromName(fileName);
        let fileTypeText = '';
        let icon = '';

        if (fileType === 'application/pdf') {
            fileTypeText = 'PDF';
            icon = 'https://upload.wikimedia.org/wikipedia/commons/8/87/PDF_file_icon.svg';
        } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            fileTypeText = 'DOCX';
            icon = 'https://upload.wikimedia.org/wikipedia/commons/f/fd/Microsoft_Office_Word_%282019%E2%80%93present%29.svg';
        } else if (fileType.startsWith('image/')) {
            fileTypeText = 'IMG';
            icon = 'https://upload.wikimedia.org/wikipedia/commons/b/b1/GNOME_Photos_logo_2019.svg';
        } else {
            fileTypeText = 'FILE';
            icon = 'https://upload.wikimedia.org/wikipedia/commons/8/8f/File_upload.svg';
        }

        // Create file icon
        const fileIcon = document.createElement('img');
        fileIcon.src = icon;
        fileIcon.alt = fileTypeText + ' Icon';
        fileIcon.className = 'file-icon';

        // Create file name element
        const fileNameElement = document.createElement('p');
        fileNameElement.className = 'file-name';
        fileNameElement.textContent = fileName;

        // Create download icon
        const downloadIcon = document.createElement('div');
        downloadIcon.className = 'download-icon';
        downloadIcon.innerHTML = `<img src="img/arrow_14056313.png" alt="Download" />`;
        const iconImg = downloadIcon.querySelector('img');
        iconImg.style.width = '50px';
        iconImg.style.height = 'auto';

        // Add click handler for download
        downloadIcon.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            downloadFile(url, fileName);
        });

        // Add remove button only if user is owner
        if (isOwner) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.innerHTML = '&minus;';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                deleteFile(fileName);
            };
            fileContainer.appendChild(removeBtn);
        }

        // Append elements
        fileContainer.appendChild(fileIcon);
        fileContainer.appendChild(fileNameElement);
        fileContainer.appendChild(downloadIcon);

        // Add to display container
        const fileDisplay = document.getElementById('fileDisplay');
        if (fileDisplay) {
            fileDisplay.appendChild(fileContainer);
        }

    } catch (error) {
        console.error('Error displaying file:', error);
    }
}

// Function to get file type from file name
function getFileTypeFromName(fileName) {
    const extension = fileName.split('.').pop().toLowerCase();
    switch (extension) {
        case 'pdf':
            return 'application/pdf';
        case 'docx':
            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'gif':
            return 'image/' + extension;
        default:
            return 'application/octet-stream';
    }
}

// Function to fetch and display files on page load
let __filesFetchInProgress = false;
async function fetchFiles() {
    try {
        if (__filesFetchInProgress) {
            console.debug('fetchFiles: already in progress, skipped');
            return false;
        }
        __filesFetchInProgress = true;

        const roomData = JSON.parse(localStorage.getItem('currentRoom'));
        if (!roomData?.folderPath) {
            throw new Error('No active room');
        }

        const fileDisplay = document.getElementById('fileDisplay');
        if (!fileDisplay) {
            throw new Error('File display element not found');
        }

        // Clear existing files
        fileDisplay.innerHTML = '';

        const response = await fetch(`/api/files/${roomData.folderPath}`, {
            headers: {
                'Authorization': `Bearer ${await getAuthToken()}`
            }
        });

        if (response.status === 404) {
            // Room not found or deleted
            localStorage.removeItem('currentRoom');
            showNotification('This room has been deleted', 'error');
            window.location.href = '/';
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to fetch files');
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Failed to fetch files');
        }

        // Display files
        if (data.files && data.files.length > 0) {
            for (const file of data.files) {
                // Verify file exists before displaying
                const checkResponse = await fetch(file.url, { method: 'HEAD' });
                if (checkResponse.ok) {
                    await displayFile(file, file.url, file.name);
                } else {
                    console.warn(`File ${file.name} not found on storage`);
                }
            }
        }

        return true;
    } catch (error) {
        console.error('Error fetching files:', error);
        showNotification(error.message, 'error');
        return false;
    } finally {
        __filesFetchInProgress = false;
    }
}
// Add delete file function
async function deleteFile(fileName) {
    try {
        const roomData = JSON.parse(localStorage.getItem('currentRoom'));
        if (!roomData || !currentUser) throw new Error('Missing room or user data');

        const ownerId = roomData.folderPath.split('/')[1].split('_')[0]; // userId prefix
        if (currentUser.userId !== ownerId) {
            throw new Error('Only room owner can delete files');
        }

        const confirmed = confirm(`Are you sure you want to delete ${fileName}?`);
        if (!confirmed) return;

        const response = await fetch(`/delete/${encodeURIComponent(roomData.folderPath + '/' + fileName)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${await getAuthToken()}` }
        });
        if (!response.ok) throw new Error('Failed to delete file');

        const fileContainer = document.querySelector(`.file-container[data-filename="${fileName}"]`);
        if (fileContainer) {
            fileContainer.style.opacity = '0';
            fileContainer.style.transform = 'translateX(20px)';
            setTimeout(() => fileContainer.remove(), 300);
        }
        showNotification('File deleted successfully', 'success');
    } catch (error) {
        console.error('Error deleting file:', error);
        showNotification(error.message, 'error');
    }
}

// Function to check authentication status
async function checkAuth() {
    try {
        // Use session endpoint; returns { authenticated: true/false }
        const response = await fetch('/api/session', { credentials: 'include' });
        const data = await response.json();
        return !!data.authenticated;
    } catch (error) {
        console.error('Error checking auth:', error);
        // Do not force logout on transient network issues
        return true;
    }
}

// Check authentication every 45 minutes
setInterval(checkAuth, 45 * 60 * 1000);

// Set a timeout to redirect after 45 minutes (was 6 minutes)
setTimeout(() => {
    window.location.href = '/';
}, 45 * 60 * 1000);

// Update the owner-specific styles
const ownerStyles = document.createElement('style');
ownerStyles.textContent = `
    .file-container .delete-btn {
        display: none;
    }

    .file-container.owner-file .delete-btn {
        display: inline-flex;
    }

    .file-container:not(.owner-file) .delete-btn {
        display: none !important;
    }
`;
document.head.appendChild(ownerStyles);

// Function to handle room joining
async function joinRoom(roomCode) {
    try {
        const response = await fetch(`/api/room/join/${roomCode}`, { credentials: 'include' });
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Failed to join room');
        }
        localStorage.setItem('currentRoom', JSON.stringify(data)); // contains owner username
        window.location.href = '/homepage';
    } catch (error) {
        console.error('Error joining room:', error);
        showNotification(error.message, 'error');
        throw error;
    }
}

// Add this helper function for notifications
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    // Add progress bar
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    notification.appendChild(progressBar);
    
    document.body.appendChild(notification);
    
    // Remove after animation
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add this CSS to ensure delete buttons are properly hidden
const styles = document.createElement('style');
styles.textContent = `
    .file-container .delete-btn {
        display: none;
    }

    .file-container:hover .delete-btn {
        display: inline-flex;
    }
`;
document.head.appendChild(styles);

// Add this to initialize the page when it loads
document.addEventListener('DOMContentLoaded', initializeApp);

// Update the handleFiles function with parallel processing
async function handleFiles(files) {
    // Reentrancy guard to avoid accidental double-processing
    if (window.__handlingFiles) return;
    window.__handlingFiles = true;

    const MAX_FILE_SIZE = 4.5 * 1024 * 1024; // 4.5MB in bytes
    const uploadQueue = [];
    const skippedFiles = [];
    let totalProgress = 0;

    // Process each file
    for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
            skippedFiles.push(file);
        } else {
            uploadQueue.push(file);
        }
    }

    // Show skipped files progress
    skippedFiles.forEach(file => {
        const skipProgressContainer = createProgressContainer();
        document.body.appendChild(skipProgressContainer);
        
        const progressBar = skipProgressContainer.querySelector('.progress-bar');
        const progressText = skipProgressContainer.querySelector('.progress-text');
        
        progressBar.style.background = '#e67e22 !important';
        skipProgressContainer.style.borderColor = '#e67e22';
        progressText.textContent = 'File Skipped (>4.5MB)';
        progressBar.style.width = '100%';
        
        setTimeout(() => {
            skipProgressContainer.style.opacity = '0';
            setTimeout(() => skipProgressContainer.remove(), 300);
        }, 2000);
    });

    if (uploadQueue.length === 0) return;

    // Create progress container for uploads
    const progressContainer = createProgressContainer();
    document.body.appendChild(progressContainer);
    
    const progressBar = progressContainer.querySelector('.progress-bar');
    const progressText = progressContainer.querySelector('.progress-text');

    // Process uploads in parallel
    const totalFiles = uploadQueue.length;
    let completedFiles = 0;

    try {
        await Promise.all(uploadQueue.map(async (file) => {
            try {
                await uploadFile(file, (progress) => {
                    // Calculate overall progress
                    const fileProgress = progress / totalFiles;
                    totalProgress += fileProgress;
                    
                    // Update progress bar
                    progressBar.style.width = `${totalProgress}%`;
                    progressText.textContent = `Uploading: ${Math.round(totalProgress)}%`;
                });
                completedFiles++;
            } catch (error) {
                console.error('Upload error for file:', file.name, error);
            }
        }));

        // All files completed
        if (completedFiles > 0) {
            progressBar.style.background = '#2ecc71 !important';
            progressContainer.style.borderColor = '#2ecc71';
            progressText.textContent = 'Upload Complete!';
            
            // Refresh file list only once after all uploads
            await fetchFiles();
        }
    } catch (error) {
        console.error('Upload error:', error);
        progressBar.style.background = '#e74c3c !important';
        progressContainer.style.borderColor = '#e74c3c';
        progressText.textContent = 'Upload Failed!';
    } finally {
        // Remove progress bar after delay
        setTimeout(() => {
            progressContainer.style.opacity = '0';
            setTimeout(() => progressContainer.remove(), 300);
        }, 2000);

        // Release guard
        window.__handlingFiles = false;
    }
}

// Helper function to create progress container
function createProgressContainer() {
    const container = document.createElement('div');
    container.className = 'file-upload-progress';
    container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        width: 300px;
        background: rgba(33, 33, 33, 0.95);
        border-radius: 12px;
        padding: 15px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        z-index: 1000;
        border: 2px solid transparent;
        transition: all 0.3s ease;
    `;
    
    container.innerHTML = `
        <div class="progress-wrapper" style="
            width: 100%;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            overflow: hidden;
            margin-bottom: 10px;
            height: 6px;
            position: relative;
        ">
            <div class="progress-bar" style="
                position: absolute;
                left: 0;
                top: 0;
                height: 100%;
                background: #3498db !important;
                width: 0%;
                transition: all 0.3s ease;
                border-radius: 6px;
            "></div>
        </div>
        <div class="progress-text" style="
            color: white;
            font-size: 14px;
            text-align: center;
        ">Processing...</div>
    `;
    
    return container;
}

// Update the deleteRoom function to use the global roomManager
async function deleteRoom(roomCode) {
    try {
        const response = await fetch(`/api/room/${roomCode}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${await getAuthToken()}`
            }
        });

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Failed to delete room');
        }

        // If currently in the deleted room, redirect to homepage
        const currentRoom = JSON.parse(localStorage.getItem('currentRoom'));
        if (currentRoom && currentRoom.roomCode === roomCode) {
            localStorage.removeItem('currentRoom');
            window.location.href = '/homepage';
        }

        showNotification('Room deleted successfully', 'success');
        return data;
    } catch (error) {
        console.error('Error deleting room:', error);
        showNotification(error.message, 'error');
        throw error;
    }
}

// Function to handle file downloads
async function downloadFile(url, fileName) {
    try {
        // Show download progress notification
        showNotification(`Checking file ${fileName}...`, 'info');

        // First verify file exists
        const response = await fetch(url, { method: 'HEAD' });
        if (!response.ok) {
            throw new Error('File not found');
        }

        // Fetch the file content
        const downloadResponse = await fetch(url);
        if (!downloadResponse.ok) {
            throw new Error('File not found or corrupted');
        }

        const blob = await downloadResponse.blob();
        
        // Verify blob size
        if (blob.size === 0) {
            throw new Error('File appears to be empty or corrupted');
        }

        // Create object URL for the blob
        const blobUrl = window.URL.createObjectURL(blob);
        
        // Create temporary link for download
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName;
        link.style.display = 'none';
        
        // Add to document, click, and cleanup
        document.body.appendChild(link);
        link.click();
        
        // Cleanup
        setTimeout(() => {
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);
        }, 100);

        showNotification(`Downloading ${fileName}...`, 'success');

    } catch (error) {
        console.error('Error downloading file:', error);
        showNotification('File not found or corrupted. Refreshing file list...', 'error');
        
        // Refresh the file list
        setTimeout(async () => {
            try {
                await fetchFiles();
                showNotification('File list refreshed', 'info');
            } catch (refreshError) {
                console.error('Error refreshing files:', refreshError);
                showNotification('Error refreshing file list', 'error');
            }
        }, 2000);
    }

    
}

// Initialize everything
document.addEventListener('DOMContentLoaded', async () => {
    await initializeApp();
    setTimeout(initializeWebSocket, 1000);
});
