// Notes functionality
function generateRandomId(length = 4) {
    // Generate exactly 4 alphanumeric characters (uppercase, lowercase, digits)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function openNotesPopup() {
    const popup = document.getElementById('notesPopup');
    const backdrop = document.getElementById('notesBackdrop');
    const textarea = document.getElementById('notesTextarea');
    const nameInput = document.getElementById('notesName');
    
    popup.classList.add('active');
    backdrop.classList.add('active');
    setTimeout(() => {
        textarea.focus();
    }, 300);
    
    // Reset form
    textarea.value = '';
    if (nameInput) nameInput.value = '';
    updateCharCounter();
    
    // Add backdrop click to close
    backdrop.addEventListener('click', () => {
        closeNotesPopup();
    });
}

function closeNotesPopup() {
    const popup = document.getElementById('notesPopup');
    const backdrop = document.getElementById('notesBackdrop');
    popup.classList.remove('active');
    backdrop.classList.remove('active');
}

function updateCharCounter() {
    const textarea = document.getElementById('notesTextarea');
    const counter = document.querySelector('.notes-textarea-group .char-counter');
    const length = textarea.value.length;
    const maxLength = 5000;
    
    counter.textContent = `${length}/${maxLength}`;
    
    // Update counter color based on length
    counter.classList.remove('warning', 'danger');
    if (length > maxLength * 0.8) {
        counter.classList.add('warning');
    }
    if (length > maxLength * 0.95) {
        counter.classList.add('danger');
    }
}

async function saveNotesToFile() {
    const textarea = document.getElementById('notesTextarea');
    const doneBtn = document.getElementById('saveNotes');
    const content = textarea.value.trim();
    
    if (!content) {
        showStatusMessage('Please enter some content for your note.', 'error');
        return;
    }
    
    // Show loading state
    doneBtn.classList.add('loading');
    
    try {
        // Get current room data - this should be set by main.js when joining/creating room
        const roomData = JSON.parse(localStorage.getItem('currentRoom'));
        if (!roomData || !roomData.folderPath) {
            throw new Error('Room information not found. Please refresh the page and try again.');
        }
        
        console.log('Room data:', roomData); // Debug log
        
        // Generate filename - custom name or auto-generated
        const nameInput = document.getElementById('notesName');
        const customName = nameInput ? nameInput.value.trim() : '';
        
        let filename;
        if (customName) {
            // Use custom name with .txt extension
            // Sanitize filename - remove invalid characters
            const sanitizedName = customName.replace(/[<>:"/\|?*]/g, '_');
            filename = `${sanitizedName}.txt`;
        } else {
            // Use auto-generated format: quicknotes_YYYY-MM-DD_XXXX.txt
            const now = new Date();
            const timestamp = now.toISOString().slice(0, 10); // YYYY-MM-DD format
            const randomId = generateRandomId(4); // Exactly 4 alphanumeric characters
            filename = `quicknotes_${timestamp}_${randomId}.txt`;
        }
        
        console.log('Generated filename:', filename); // Debug log
        
        // Prepare the request data
        const requestData = {
            content: content,
            filename: filename,
            folderPath: roomData.folderPath
        };
        
        console.log('Request data being sent:', requestData); // Debug log
        
        // Send request to backend to create and upload the note
        const response = await fetch('/api/notes/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include', // Add credentials for session-based auth
            body: JSON.stringify(requestData)
        });

        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message || 'Failed to save note');
        }
        
        console.log('Note saved successfully:', result); // Debug log
        
        // Close popup and show success
        closeNotesPopup();
        showStatusMessage(`Note saved as ${filename}`, 'success');
        
        // Refresh the file list to show the new note
        if (typeof window.fetchFiles === 'function') {
            await window.fetchFiles();
        }
        
    } catch (error) {
        console.error('Failed to save note:', error);
        showStatusMessage('Failed to save note. Please try again.', 'error');
    } finally {
        doneBtn.classList.remove('loading');
    }
}

function showStatusMessage(message, type) {
    // Create or update Notes-specific status message
    let statusMsg = document.querySelector(`.notes-status-message.${type}`);
    if (!statusMsg) {
        statusMsg = document.createElement('div');
        statusMsg.className = `notes-status-message ${type}`;
        document.body.appendChild(statusMsg);
    }
    
    // Update content with Notes-style icons
    statusMsg.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            ${type === 'success' 
                ? '<path d="M20 6L9 17l-5-5" stroke-width="2"></path>'
                : '<circle cx="12" cy="12" r="10" stroke-width="2"></circle><path d="M15 9l-6 6M9 9l6 6" stroke-width="2"></path>'
            }
        </svg>
        <span>${message}</span>
    `;
    
    // Show message with Notes-style animation
    statusMsg.classList.add('show');
    
    // Hide after 4 seconds (slightly longer for Notes)
    setTimeout(() => {
        statusMsg.classList.remove('show');
    }, 4000);
}

// Event listeners for Notes
document.addEventListener('DOMContentLoaded', () => {
    // Notes button click
    const notesBtn = document.getElementById('notesBtn');
    if (notesBtn) {
        notesBtn.addEventListener('click', openNotesPopup);
    }
    
    // Close button click
    const closeBtn = document.getElementById('closeNotes');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeNotesPopup);
    }
    
    // ESC key or close button will handle canceling (no separate cancel button)
    
    // Form submit
    const notesForm = document.getElementById('notesForm');
    if (notesForm) {
        notesForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveNotesToFile();
        });
    }
    
    // Textarea character counter
    const textarea = document.getElementById('notesTextarea');
    if (textarea) {
        textarea.addEventListener('input', updateCharCounter);
    }
    
    // Escape key to close popup
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const popup = document.getElementById('notesPopup');
            if (popup && popup.classList.contains('active')) {
                closeNotesPopup();
            }
        }
    });
});