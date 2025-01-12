// XyloMail Functionality
document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const mailBtn = document.getElementById('xyloMailBtn');
    const mailPopup = document.getElementById('xyloMailPopup');
    const closeBtn = document.getElementById('closeXyloMail');
    const fileInput = document.getElementById('mailFileInput');
    const fileText = document.querySelector('.file-text');
    const form = document.getElementById('xyloMailForm');
    const messageInput = document.getElementById('mailMessage');
    const charCounter = document.querySelector('.char-counter');
    const sizeAlert = document.querySelector('.size-limit-alert');
    
    // Constants
    const MAX_SIZE = 4.5 * 1024 * 1024; // 4.5MB in bytes
    let selectedFiles = [];

    // Toggle popup
    mailBtn.addEventListener('click', () => {
        mailPopup.classList.add('active');
    });

    closeBtn.addEventListener('click', () => {
        mailPopup.classList.remove('active');
    });

    // Close popup when clicking outside
    document.addEventListener('click', (e) => {
        if (!mailPopup.contains(e.target) && !mailBtn.contains(e.target) && mailPopup.classList.contains('active')) {
            mailPopup.classList.remove('active');
        }
    });

    // File input handler specifically for XyloMail
    fileInput.addEventListener('change', function() {
        const files = Array.from(this.files);
        const totalSize = files.reduce((sum, file) => sum + file.size, 0);
        
        if (totalSize > MAX_SIZE) {
            sizeAlert.classList.add('show');
            setTimeout(() => sizeAlert.classList.remove('show'), 3000);
            this.value = '';
            fileText.textContent = 'No files chosen';
            return;
        }

        if (files.length > 0) {
            const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
            fileText.textContent = `${files.length} file(s) selected (${totalSizeMB}MB)`;
        } else {
            fileText.textContent = 'No files chosen';
        }
    });

    // Character counter
    messageInput.addEventListener('input', function() {
        const maxLength = 250;
        const length = this.value.length;
        
        // Update counter
        charCounter.textContent = `${length}/${maxLength}`;
        
        // Handle limit
        if (length >= maxLength) {
            charCounter.classList.add('limit');
            // Prevent further input if at limit
            if (length > maxLength) {
                this.value = this.value.substring(0, maxLength);
            }
        } else if (length > 200) {
            charCounter.classList.add('limit');
        } else {
            charCounter.classList.remove('limit');
        }
    });

    // Email chips functionality
    const emailInput = document.getElementById('receiverEmail');
    const chipsWrapper = document.querySelector('.chips-wrapper');
    const recipientLimitAlert = document.querySelector('.recipient-limit-alert');
    let emailChips = [];

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function addEmailChip(email) {
        if (!email || !isValidEmail(email) || emailChips.includes(email) || emailChips.length >= 5) {
            if (emailChips.length >= 5) {
                recipientLimitAlert.style.display = 'block';
            }
            return false;
        }

        const chip = document.createElement('div');
        chip.className = 'email-chip';
        chip.innerHTML = `
            <span class="chip-text">${email}</span>
            <button type="button" class="remove-chip" aria-label="Remove email">×</button>
        `;
        chip.querySelector('.remove-chip').addEventListener('click', () => {
            chip.remove();
            emailChips = emailChips.filter(e => e !== email);
            emailInput.style.display = 'block';
            recipientLimitAlert.style.display = 'none';
        });

        emailChips.push(email);
        chipsWrapper.appendChild(chip);
        emailInput.value = '';

        if (emailChips.length >= 5) {
            emailInput.style.display = 'none';
            recipientLimitAlert.style.display = 'block';
        }

        return true;
    }

    // Handle email input
    emailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addEmailChip(emailInput.value.trim().replace(',', ''));
        }
    });

    emailInput.addEventListener('blur', () => {
        addEmailChip(emailInput.value.trim());
    });

    // Form submission
    document.getElementById('xyloMailForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (emailChips.length === 0 || !document.getElementById('mailFileInput').files.length) {
            alert("Please provide both recipient email(s) and file(s).");
            return;
        }

        const submitBtn = document.querySelector('.submit-btn');
        submitBtn.classList.add('sending');
        const progressText = submitBtn.querySelector('.progress-text');
        const progressStatus = submitBtn.querySelector('.progress-status');

        try {
            const formData = new FormData();
            formData.append('emails', JSON.stringify(emailChips));
            formData.append('message', document.getElementById('mailMessage').value.trim());
            Array.from(document.getElementById('mailFileInput').files).forEach(file => {
                formData.append('files', file);
            });

            const response = await fetch('/send-email', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();
            
            if (response.ok) {
                // Show success state
                submitBtn.classList.remove('sending');
                submitBtn.classList.add('success');
                progressStatus.innerHTML = `
                    <svg class="success-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M20 6L9 17l-5-5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span class="progress-text">Email${emailChips.length > 1 ? 's' : ''} Sent Successfully!</span>
                `;
                
                // Reset form after delay
                setTimeout(() => {
                    document.getElementById('xyloMailForm').reset();
                    emailChips = [];
                    chipsWrapper.innerHTML = '';
                    emailInput.style.display = 'block';
                    recipientLimitAlert.style.display = 'none';
                    document.querySelector('.file-text').textContent = 'No files chosen';
                    document.getElementById('xyloMailPopup').classList.remove('active');
                    
                    // Reset button state
                    submitBtn.classList.remove('success');
                    submitBtn.innerHTML = `
                        <div class="btn-content">
                            <span>Send Mail</span>
                            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"></path>
                            </svg>
                        </div>
                        <div class="progress-status">
                            <span class="progress-text">Sending</span>
                            <div class="progress-dots">
                                <div class="progress-dot"></div>
                                <div class="progress-dot"></div>
                                <div class="progress-dot"></div>
                            </div>
                        </div>
                    `;
                }, 2000);
            } else {
                // Show error state
                submitBtn.classList.remove('sending');
                submitBtn.classList.add('error');
                progressStatus.innerHTML = `
                    <svg class="error-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="12" cy="12" r="10" stroke-width="2"/>
                        <path d="M15 9l-6 6M9 9l6 6" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    <span class="progress-text">Failed to Send Email${emailChips.length > 1 ? 's' : ''}</span>
                `;
                
                setTimeout(() => {
                    submitBtn.classList.remove('error');
                    submitBtn.innerHTML = `
                        <div class="btn-content">
                            <span>Send Mail</span>
                            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"></path>
                            </svg>
                        </div>
                        <div class="progress-status">
                            <span class="progress-text">Sending</span>
                            <div class="progress-dots">
                                <div class="progress-dot"></div>
                                <div class="progress-dot"></div>
                                <div class="progress-dot"></div>
                            </div>
                        </div>
                    `;
                }, 2000);
                
                alert(result.error || 'Error sending email. Please try again.');
            }
        } catch (error) {
            console.error('Error:', error);
            submitBtn.classList.remove('sending');
            submitBtn.classList.add('error');
            progressStatus.innerHTML = `
                <svg class="error-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="12" cy="12" r="10" stroke-width="2"/>
                    <path d="M15 9l-6 6M9 9l6 6" stroke-width="2" stroke-linecap="round"/>
                </svg>
                <span class="progress-text">Failed to Send Email${emailChips.length > 1 ? 's' : ''}</span>
            `;
            
            setTimeout(() => {
                submitBtn.classList.remove('error');
                submitBtn.innerHTML = `
                    <div class="btn-content">
                        <span>Send Mail</span>
                        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"></path>
                        </svg>
                    </div>
                    <div class="progress-status">
                        <span class="progress-text">Sending</span>
                        <div class="progress-dots">
                            <div class="progress-dot"></div>
                            <div class="progress-dot"></div>
                            <div class="progress-dot"></div>
                        </div>
                    </div>
                `;
            }, 2000);
            
            alert('Error sending email. Please try again later.');
        }
    });

    // Add escape key listener
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mailPopup.classList.contains('active')) {
            mailPopup.classList.remove('active');
        }
    });
});