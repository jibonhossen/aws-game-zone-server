require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const axios = require('axios');

const { Expo } = require('expo-server-sdk');

const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const port = process.env.PORT || 3000;
const expo = new Expo();

// Socket.io Connection Logic
io.on('connection', (socket) => {
    console.log(`[Socket] New client connected: ${socket.id}`);

    socket.on('heartbeat', (data) => {
        // console.log(`[Socket] Heartbeat received from ${socket.id}`);
        // Optional: Update last_seen in Supabase if needed
    });

    socket.on('disconnect', () => {
        console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
});

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Cloudflare Worker configuration
const workerUrl = process.env.WORKER_URL;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    console.log("request received")
    res.json({ message: 'Hello World!' });
});

// 1. Receive withdrawal from Worker
app.post('/api/withdrawals/new', async (req, res) => {
    try {
        const withdrawal = req.body;

        // Insert into Supabase
        const { data, error } = await supabase
            .from('withdrawals')
            .insert([{
                id: withdrawal.id, // Use the D1 transaction UUID
                txn_id: withdrawal.transactionId,
                uid: withdrawal.uid,
                amount: withdrawal.amount,
                payment_method: withdrawal.paymentMethod,
                payment_number: withdrawal.paymentNumber,
                username: withdrawal.username,
                status: 'pending',
                created_at: withdrawal.createdAt || new Date().toISOString()
            }]);

        if (error) throw error;

        // Notify Admins via Push Notification
        try {
            const { data: adminTokens, error: tokenError } = await supabase
                .from('admin_tokens')
                .select('token');

            if (!tokenError && adminTokens.length > 0) {
                const messages = [];
                for (let admin of adminTokens) {
                    if (!Expo.isExpoPushToken(admin.token)) {
                        console.error(`Push token ${admin.token} is not a valid Expo push token`);
                        continue;
                    }
                    messages.push({
                        to: admin.token,
                        sound: 'default',
                        title: 'New Withdrawal Request! 💰',
                        body: `${withdrawal.username} requested ৳${withdrawal.amount} via ${withdrawal.paymentMethod}`,
                        data: { type: 'withdrawal', id: withdrawal.id },
                    });
                }

                const chunks = expo.chunkPushNotifications(messages);
                for (let chunk of chunks) {
                    try {
                        await expo.sendPushNotificationsAsync(chunk);
                    } catch (error) {
                        console.error('Error sending push notification chunk:', error);
                    }
                }
            }
        } catch (pushError) {
            console.error('Failed to send push notifications:', pushError);
        }

        res.status(201).json({ message: 'Withdrawal recorded and notification sent' });
    } catch (error) {
        console.error('Error recording withdrawal:', error);
        res.status(500).json({ error: error.message });
    }
});

// 2. Fetch pending withdrawals for Admin app
app.get('/api/withdrawals', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('withdrawals')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Verify/Update status from Admin app
app.post('/api/withdrawals/verify', async (req, res) => {
    try {
        const { id, status } = req.body; // status: 'completed' or 'rejected'

        // 1. Update Supabase
        const { error } = await supabase
            .from('withdrawals')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', id);

        if (error) throw error;

        // 2. Callback to Worker to update D1
        try {
            await axios.put(`${workerUrl}/internal/withdraw-status`, { id, status });
        } catch (workerError) {
            console.error('Failed to notify worker:', workerError.message);
        }

        res.json({ message: `Withdrawal ${status}` });
    } catch (error) {
        console.error('Error verifying withdrawal:', error);
        res.status(500).json({ error: error.message });
    }
});

// 4. Register Admin Push Token
app.post('/api/admin/register-token', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: 'Token is required' });

        const { error } = await supabase
            .from('admin_tokens')
            .upsert([{ token }], { onConflict: 'token' });

        if (error) throw error;
        res.json({ message: 'Token registered successfully' });
    } catch (error) {
        console.error('Error registering token:', error);
        res.status(500).json({ error: error.message });
    }
});

server.listen(port, () => {
    console.log(`EC2 Withdrawal Server listening at http://localhost:${port}`);
});
