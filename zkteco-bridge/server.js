require('dotenv').config();
const admin = require('firebase-admin');
const ZKLib = require('node-zklib');
const crypto = require('crypto');

// 1. Initialize Firebase Admin
// Replace with your actual service account path/configuration
let serviceAccount;
try {
    serviceAccount = require('./serviceAccountKey.json');
} catch (e) {
    console.error("Missing serviceAccountKey.json file! Please add it to the zkteco-bridge folder.");
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// 2. Initialize ZKTeco Device connection
const ZK_IP = process.env.ZK_IP || '192.168.1.201';
const ZK_PORT = process.env.ZK_PORT || 4370;

let zkInstance = null;

async function connectToDevice() {
    try {
        zkInstance = new ZKLib(ZK_IP, ZK_PORT, 10000, 4000);
        console.log(`[ZKTeco] Attempting connection to ${ZK_IP}:${ZK_PORT}...`);
        
        await zkInstance.createSocket();
        
        console.log('[ZKTeco] Connected Successfully.');

        // 3. Start real-time listening
        listenForScans();

    } catch (err) {
        console.error('[ZKTeco] Connection Failed:', err.message);
        // Retry connection every 10 seconds if it fails
        setTimeout(connectToDevice, 10000);
    }
}

async function listenForScans() {
    console.log('[ZKTeco] Starting real-time listener...');

    zkInstance.getRealTimeLogs(async (data) => {
        // data format varies but usually contains userId / uid / timestamp
        const userId = data.userId || data.uid;
        if (!userId) return;

        console.log(`[ZKTeco] Scan detected -> Fingerprint ID: ${userId}`);

        // Push to Firebase Firestore `kioskScans`
        const scanDoc = {
            id: crypto.randomUUID(),
            fingerprint_id: String(userId),
            kiosk_id: 'kiosk_main', // Replace if running multi-kiosk setup
            ts: Date.now(),
            device_ip: ZK_IP
        };

        try {
            await db.collection('kioskScans').doc(scanDoc.id).set(scanDoc);
            console.log(`[Firebase] Successfully pushed scan ${scanDoc.id}`);
        } catch (err) {
            console.error(`[Firebase] Failed to push scan:`, err.message);
            // Implement offline queue/retry here for production hardening if needed
        }
    });

    // Handle disconnections
    zkInstance.on('disconnect', () => {
        console.warn('[ZKTeco] Device disconnected. Reconnecting...');
        setTimeout(connectToDevice, 5000);
    });
}

// Start Application
connectToDevice();
