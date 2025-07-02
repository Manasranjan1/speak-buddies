// server.js - SpeakBuddies Backend Server
const express = require('express');
const cors = require('cors');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Agora Configuration
const AGORA_APP_ID = process.env.AGORA_APP_ID || 'your_agora_app_id';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || 'your_agora_app_certificate';

// Predefined topics for conversation
const TOPICS = [
    "Talk about your favorite book and why you love it",
    "Describe your dream vacation destination",
    "Share a memorable childhood experience",
    "Discuss your hobbies and interests",
    "Talk about your favorite movie or TV show",
    "Describe your ideal weekend",
    "Share what you're passionate about",
    "Discuss your goals for the future",
    "Talk about your favorite food or cuisine",
    "Describe a person who inspires you",
    "Talk about a skill you'd like to learn",
    "Discuss your favorite season and why",
    "Share an interesting fact you recently learned",
    "Talk about your hometown or city",
    "Describe your perfect day"
];

// In-memory storage for user pairing
let waitingUsers = [];
let activeChannels = new Map();

// Generate random channel name
function generateChannelName() {
    return `channel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Generate random topic
function getRandomTopic() {
    return TOPICS[Math.floor(Math.random() * TOPICS.length)];
}

// Generate Agora token
function generateAgoraToken(channelName, uid = 0) {
    const role = RtcRole.PUBLISHER;
    const expirationTimeInSeconds = 3600; // 1 hour
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    try {
        const token = RtcTokenBuilder.buildTokenWithUid(
            AGORA_APP_ID,
            AGORA_APP_CERTIFICATE,
            channelName,
            uid,
            role,
            privilegeExpiredTs
        );
        return token;
    } catch (error) {
        console.error('Error generating Agora token:', error);
        // Return a mock token for development
        return `mock_token_${channelName}_${uid}`;
    }
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Get token and pair users
app.post('/api/get-token', (req, res) => {
    try {
        const userId = req.body.userId || `user_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        
        // Check if there's a waiting user
        if (waitingUsers.length > 0) {
            // Pair with waiting user
            const waitingUser = waitingUsers.shift();
            const channelName = waitingUser.channelName;
            const topic = waitingUser.topic;
            
            // Generate tokens for both users
            const token1 = generateAgoraToken(channelName, 1);
            const token2 = generateAgoraToken(channelName, 2);
            
            // Store active channel
            activeChannels.set(channelName, {
                users: [waitingUser.userId, userId],
                topic: topic,
                startTime: Date.now(),
                maxDuration: 10 * 60 * 1000 // 10 minutes
            });
            
            // Respond to current user
            res.json({
                success: true,
                token: token2,
                channelName: channelName,
                topic: topic,
                appId: AGORA_APP_ID,
                uid: 2,
                paired: true
            });
            
            console.log(`Paired users: ${waitingUser.userId} and ${userId} in channel ${channelName}`);
            
        } else {
            // No waiting user, add to queue
            const channelName = generateChannelName();
            const topic = getRandomTopic();
            const token = generateAgoraToken(channelName, 1);
            
            waitingUsers.push({
                userId: userId,
                channelName: channelName,
                topic: topic,
                timestamp: Date.now()
            });
            
            res.json({
                success: true,
                token: token,
                channelName: channelName,
                topic: topic,
                appId: AGORA_APP_ID,
                uid: 1,
                paired: false,
                waiting: true
            });
            
            console.log(`User ${userId} added to waiting queue for channel ${channelName}`);
        }
        
    } catch (error) {
        console.error('Error in get-token:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate token'
        });
    }
});

// End call
app.post('/api/end-call', (req, res) => {
    try {
        const { channelName, userId } = req.body;
        
        if (activeChannels.has(channelName)) {
            activeChannels.delete(channelName);
            console.log(`Call ended for channel ${channelName} by user ${userId}`);
        }
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Error ending call:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to end call'
        });
    }
});

// Get active channels (for monitoring)
app.get('/api/active-channels', (req, res) => {
    const channels = Array.from(activeChannels.entries()).map(([channelName, data]) => ({
        channelName,
        users: data.users,
        topic: data.topic,
        duration: Date.now() - data.startTime,
        maxDuration: data.maxDuration
    }));
    
    res.json({
        activeChannels: channels.length,
        waitingUsers: waitingUsers.length,
        channels: channels
    });
});

// Cleanup expired channels and waiting users
function cleanup() {
    const now = Date.now();
    const WAITING_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    
    // Remove expired waiting users
    waitingUsers = waitingUsers.filter(user => {
        const isExpired = (now - user.timestamp) > WAITING_TIMEOUT;
        if (isExpired) {
            console.log(`Removed expired waiting user: ${user.userId}`);
        }
        return !isExpired;
    });
    
    // Remove expired active channels
    for (const [channelName, data] of activeChannels.entries()) {
        if ((now - data.startTime) > data.maxDuration) {
            activeChannels.delete(channelName);
            console.log(`Removed expired channel: ${channelName}`);
        }
    }
}

// Run cleanup every minute
setInterval(cleanup, 60000);

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`SpeakBuddies server running on port ${PORT}`);
    console.log(`Agora App ID: ${AGORA_APP_ID}`);
    console.log(`Available endpoints:`);
    console.log(`  POST /api/get-token - Get Agora token and pair users`);
    console.log(`  POST /api/end-call - End active call`);
    console.log(`  GET /api/active-channels - Get server statistics`);
    console.log(`  GET /api/health - Health check`);
});

module.exports = app;
