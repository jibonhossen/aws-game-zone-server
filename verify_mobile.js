const io = require('socket.io-client');

const socket = io('http://localhost:1456', {
    query: {
        type: 'mobile',
        deviceId: 'TEST_DEVICE_001',
        deviceName: 'Test Mobile Client'
    }
});

socket.on('connect', () => {
    console.log('Connected to server as mobile client');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});

setTimeout(() => {
    console.log('Disconnecting...');
    socket.disconnect();
}, 5000);
