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
let connectionRequests = new Map(); // requestId -> request data
let waitingQueue = []; // Array of request IDs waiting for pairing
let activeChannels = new Map(); // channelName -> channel data

// Generate unique request ID
function generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

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

// Request connection - add user to queue or pair immediately
app.post('/api/request-connection', (req, res) => {
    try {
        const { userId } = req.body;
        const requestId = generateRequestId();
        const timestamp = Date.now();
        
        // Create connection request
        const request = {
            requestId,
            userId: userId || `user_${timestamp}`,
            timestamp,
            status: 'waiting'
        };
        
        connectionRequests.set(requestId, request);
        
        // Check if there's someone waiting
        if (waitingQueue.length > 0) {
            // Pair with the first person in queue
            const waitingRequestId = waitingQueue.shift();
            const waitingRequest = connectionRequests.get(waitingRequestId);
            
            if (waitingRequest && waitingRequest.status === 'waiting') {
                // Create channel and pair both users
                const channelName = generateChannelName();
                const topic = getRandomTopic();
                
                // Generate tokens
                const token1 = generateAgoraToken(channelName, 1);
                const token2 = generateAgoraToken(channelName, 2);
                
                // Update both requests
                waitingRequest.status = 'paired';
                waitingRequest.channelName = channelName;
                waitingRequest.topic = topic;
                waitingRequest.token = token1;
                waitingRequest.uid = 1;
                
                request.status = 'paired';
                request.channelName = channelName;
                request.topic = topic;
                request.token = token2;
                request.uid = 2;
                
                // Store active channel
                activeChannels.set(channelName, {
                    users: [waitingRequest.userId, request.userId],
                    requests: [waitingRequestId, requestId],
                    topic: topic,
                    startTime: Date.now(),
                    maxDuration: 10 * 60 * 1000 // 10 minutes
                });
                
                console.log(`Paired users: ${waitingRequest.userId} and ${request.userId} in channel ${channelName}`);
                
                // Respond with pairing data
                res.json({
                    success: true,
                    requestId: requestId,
                    paired: true,
                    token: token2,
                    channelName: channelName,
                    topic: topic,
                    appId: AGORA_APP_ID,
                    uid: 2
                });
                
            } else {
                // Waiting request was invalid, add current to queue
                waitingQueue.push(requestId);
                res.json({
                    success: true,
                    requestId: requestId,
                    paired: false
                });
            }
        } else {
            // No one waiting, add to queue
            waitingQueue.push(requestId);
            res.json({
                success: true,
                requestId: requestId,
                paired: false
            });
        }
        
    } catch (error) {
        console.error('Error in request-connection:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process connection request'
        });
    }
});

// Check if user has been paired
app.get('/api/check-pairing/:requestId', (req, res) => {
    try {
        const { requestId } = req.params;
        const request = connectionRequests.get(requestId);
        
        if (!request) {
            return res.status(404).json({
                success: false,
                error: 'Request not found'
            });
        }
        
        if (request.status === 'paired') {
            res.json({
                success: true,
                paired: true,
                token: request.token,
                channelName: request.channelName,
                topic: request.topic,
                appId: AGORA_APP_ID,
                uid: request.uid
            });
        } else {
            res.json({
                success: true,
                paired: false,
                status: request.status
            });
        }
        
    } catch (error) {
        console.error('Error in check-pairing:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check pairing status'
        });
    }
});

// Cancel connection request
app.post('/api/cancel-connection', (req, res) => {
    try {
        const { requestId } = req.body;
        
        // Remove from connection requests
        connectionRequests.delete(requestId);
        
        // Remove from waiting queue
        const queueIndex = waitingQueue.indexOf(requestId);
        if (queueIndex > -1) {
            waitingQueue.splice(queueIndex, 1);
        }
        
        console.log(`Cancelled connection request: ${requestId}`);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Error cancelling connection:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to cancel connection'
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

// Get active channels and stats (for monitoring)
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
        waitingUsers: waitingQueue.length,
        totalRequests: connectionRequests.size,
        channels: channels
    });
});

// Cleanup expired channels, requests, and waiting users
function cleanup() {
    const now = Date.now();
    const REQUEST_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    
    // Remove expired connection requests
    for (const [requestId, request] of connectionRequests.entries()) {
        if (request.status === 'waiting' && (now - request.timestamp) > REQUEST_TIMEOUT) {
            connectionRequests.delete(requestId);
            
            // Remove from waiting queue
            const queueIndex = waitingQueue.indexOf(requestId);
            if (queueIndex > -1) {
                waitingQueue.splice(queueIndex, 1);
            }
            
            console.log(`Removed expired request: ${requestId}`);
        }
    }
    
    // Remove expired active channels
    for (const [channelName, data] of activeChannels.entries()) {
        if ((now - data.startTime) > data.maxDuration) {
            // Clean up associated requests
            data.requests.forEach(reqId => {
                connectionRequests.delete(reqId);
            });
            
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
    console.log(`  POST /api/request-connection - Request pairing with another user`);
    console.log(`  GET /api/check-pairing/:requestId - Check if user has been paired`);
    console.log(`  POST /api/cancel-connection - Cancel connection request`);
    console.log(`  POST /api/end-call - End active call`);
    console.log(`  GET /api/active-channels - Get server statistics`);
    console.log(`  GET /api/health - Health check`);
});

module.exports = app;