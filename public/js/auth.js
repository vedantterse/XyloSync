// Add this at the top of the file
let clerkReady = false;

// Dynamically load Clerk with config from server
async function initializeClerk() {
    try {
        const response = await fetch('/api/clerk-config');
        if (!response.ok) {
            throw new Error(`Failed to fetch Clerk config: ${response.statusText}`);
        }
        const config = await response.json();
        
        if (!config.publishableKey || !config.frontendApi) {
            throw new Error('Clerk configuration not found in server response');
        }
        
        // Create and load Clerk script
        const script = document.createElement('script');
        script.src = `${config.frontendApi}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.type = 'text/javascript';
        script.dataset.clerkPublishableKey = config.publishableKey;
        
        // Add load event listener before appending script
        script.onload = initializeClerkFeatures;
        script.onerror = () => console.error('Failed to load Clerk script');
        document.head.appendChild(script);
    } catch (error) {
        console.error('Error initializing Clerk:', error);
    }
}

// Initialize Clerk features after script loads
async function initializeClerkFeatures() {
    if (!window.Clerk || window.clerkInstance) {
        return;
    }

    try {
        window.clerkInstance = window.Clerk;
        await window.clerkInstance.load({
            appearance: {
                layout: {
                    showOptionalFields: false,
                    socialButtonsPlacement: 'bottom',
                    logoPlacement: 'inside',
                    logoImageUrl: '/img/android-chrome-512x512.png'
                },
                variables: {
                    colorPrimary: '#3498db',
                    colorBackground: 'rgba(23, 32, 42, 0.95)',
                    colorText: '#ffffff',
                    colorInputBackground: 'rgba(255, 255, 255, 0.05)',
                    colorInputText: '#ffffff',
                    borderRadius: '8px'
                },
                elements: {
                    formButtonPrimary: {
                        backgroundColor: '#3498db',
                        '&:hover': {
                            backgroundColor: '#2980b9'
                        }
                    },
                    card: {
                        backgroundColor: 'rgba(23, 32, 42, 0.95)',
                        backdropFilter: 'blur(10px)'
                    },
                    userButton: {
                        color: '#ffffff !important'
                    },
                    userButtonPopover: {
                        color: '#ffffff !important',
                        backgroundColor: 'rgba(23, 32, 42, 0.95) !important'
                    },
                    userButtonPopoverCard: {
                        color: '#ffffff !important',
                        backgroundColor: 'rgba(23, 32, 42, 0.95) !important'
                    },
                    userButtonPopoverActions: {
                        color: '#ffffff !important',
                        backgroundColor: 'rgba(23, 32, 42, 0.95) !important'
                    },
                    userButtonPopoverFooter: {
                        color: '#ffffff !important',
                        backgroundColor: 'rgba(23, 32, 42, 0.95) !important'
                    },
                    navbarButton: {
                        color: '#ffffff !important',
                        backgroundColor: 'rgba(23, 32, 42, 0.95) !important',
                        '&:hover': {
                            backgroundColor: 'rgba(52, 152, 219, 0.2) !important'
                        },
                        '&.cl-active': {
                            backgroundColor: 'rgba(52, 152, 219, 0.2) !important',
                            color: '#ffffff !important'
                        }
                    }
                }
            }
        });

        // Set up user session and mount user button
        if (window.clerkInstance.user) {
            const userInfo = {
                username: window.clerkInstance.user.username || 
                         window.clerkInstance.user.emailAddresses[0].emailAddress.split('@')[0],
                userId: window.clerkInstance.user.id,
                email: window.clerkInstance.user.emailAddresses[0].emailAddress
            };
            
            // Set session cookie with 3-hour expiry
            document.cookie = `authenticated=true; max-age=${2.5 * 60 * 60}; path=/`;
            localStorage.setItem('userInfo', JSON.stringify(userInfo));

            // Check session expiry every minute
            const checkSession = setInterval(() => {
                const cookies = document.cookie.split(';');
                const authCookie = cookies.find(cookie => cookie.trim().startsWith('authenticated='));
                
                if (!authCookie) {
                    clearInterval(checkSession);
                    window.clerkInstance.signOut().then(() => {
                        window.location.href = '/';
                    }).catch(() => {
                        window.location.href = '/';
                    });
                }
            }, 60000);

            // Mount user button
            window.clerkInstance.mountUserButton(document.getElementById('user-button'), {
                afterSignOutUrl: '/',
                appearance: {
                    elements: {
                        userButtonBox: {
                            color: '#ffffff !important',
                            backgroundColor: '#000000 !important'
                        }
                    }
                }
            });
        }

        // Mark Clerk as ready
        clerkReady = true;
        window.dispatchEvent(new Event('clerkReady'));

    } catch (error) {
        console.error('Error initializing Clerk:', error);
    }
}

// Add a function to wait for Clerk initialization
async function waitForClerkInit(timeout = 10000) {
    const startTime = Date.now();
    while (!clerkReady || !window.clerkInstance?.user) {
        if (Date.now() - startTime > timeout) {
            throw new Error('Clerk initialization timeout');
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return true;
}

// Call initializeClerk function
initializeClerk();

// Add this function to check authentication status
async function checkAuthentication() {
    if (!window.clerkInstance?.user) {
        throw new Error('Not authenticated');
    }
    
    const userInfo = JSON.parse(localStorage.getItem('userInfo'));
    if (!userInfo?.username) {
        throw new Error('User information not found');
    }
    
    return userInfo;
}

// Update getAuthToken
async function getAuthToken() {
    try {
        await waitForClerkInit();
        const session = await window.clerkInstance.session;
        if (!session) {
            throw new Error('No active session');
        }
        return session.getToken();
    } catch (error) {
        console.error('Error getting auth token:', error);
        throw error;
    }
}
