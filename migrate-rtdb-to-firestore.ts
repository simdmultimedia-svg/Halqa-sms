import * as admin from 'firebase-admin';

// ============================================================================
// CONFIGURATION
// ============================================================================
// Replace the path below with the path to your service account JSON key file.
const SERVICE_ACCOUNT_PATH = './service-account-key.json';
const DATABASE_URL = 'https://cic-kano-223fb-default-rtdb.europe-west1.firebasedatabase.app';

// The top-level nodes in RTDB to migrate
const COLLECTIONS_TO_MIGRATE = [
    "activeSessions", "activities", "appointmentLetters", "assets", 
    "assignments", "attendance", "auditLogs", "behaviour", 
    "biometricAttendance", "cbt", "cbtAttempts", "counters", 
    "deletedInvoices", "deletedReceipts", "discounts", "examQuestions", 
    "examTimetable", "expenses", "families", "familyInvoices", 
    "familyLedger", "idCards", "inventory", "inventoryMoves", 
    "invoices", "kioskScans", "lessonPlans", "liveCBT", 
    "migrationLogs", "notifications", "onlineStatus", "passwordResetRequests", 
    "payments", "paymentVouchers", "payslips", "performanceRosters", 
    "promotionLogs", "realtimeNotifications", "receipts", "reportCards", 
    "restorePoints", "resultApprovals", "results", "salaryComplaints", 
    "schemeOfWork", "scholarships", "servicePayments", "settings", 
    "smsLogs", "staff", "staffAttendance", "staffLoginMap", 
    "staffPerformance", "staffRosters", "staffSalaries", "studentDiscounts", 
    "students", "studentScholarships", "systemTelemetry", "testimonials", 
    "userRoles", "users", "vouchers"
];

// Firestore batch limit is 500 operations. We use 450 to be safe.
const BATCH_SIZE_LIMIT = 450;

// ============================================================================
// INITIALIZATION
// ============================================================================
const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL
});

const rtdb = admin.database();
const firestore = admin.firestore();

// ============================================================================
// MIGRATION LOGIC
// ============================================================================

/**
 * Migrates a single collection from RTDB to Firestore.
 */
async function migrateCollection(collectionName: string) {
    console.log(`\n[START] Fetching RTDB node: /${collectionName}...`);
    
    try {
        const snapshot = await rtdb.ref(collectionName).once('value');
        const data = snapshot.val();

        if (!data) {
            console.log(`[SKIP] Collection /${collectionName} is empty or does not exist.`);
            return;
        }

        const entries = Object.entries(data);
        const totalRecords = entries.length;
        console.log(`[INFO] Found ${totalRecords} records in /${collectionName}. Preparing batches...`);

        let batch = firestore.batch();
        let operationCount = 0;
        let totalProcessed = 0;

        for (const [key, value] of entries) {
            const docRef = firestore.collection(collectionName).doc(key);
            
            // Handle heavily nested arrays/structures by wrapping them in a top-level object if they are primitive arrays,
            // or just saving them directly if they are objects.
            const payload = (typeof value === 'object' && value !== null && !Array.isArray(value)) 
                ? value 
                : { data: value };

            batch.set(docRef, payload, { merge: true });
            operationCount++;

            // If we hit the batch limit, commit and start a new batch.
            if (operationCount >= BATCH_SIZE_LIMIT) {
                await batch.commit();
                totalProcessed += operationCount;
                console.log(`[PROGRESS] /${collectionName}: Migrated ${totalProcessed} / ${totalRecords} records...`);
                
                // Reset batch
                batch = firestore.batch();
                operationCount = 0;
            }
        }

        // Commit any remaining operations in the final batch
        if (operationCount > 0) {
            await batch.commit();
            totalProcessed += operationCount;
            console.log(`[PROGRESS] /${collectionName}: Migrated ${totalProcessed} / ${totalRecords} records...`);
        }

        console.log(`[SUCCESS] Finished migrating /${collectionName}.`);

    } catch (error: any) {
        console.error(`[ERROR] Failed to migrate collection /${collectionName}. Reason: ${error.message}`);
    }
}

/**
 * Main Execution Function
 */
async function runMigration() {
    console.log("=================================================");
    console.log("🚀 STARTING RTDB -> FIRESTORE MIGRATION SCRIPT 🚀");
    console.log("=================================================");
    
    const startTime = Date.now();

    for (const collection of COLLECTIONS_TO_MIGRATE) {
        await migrateCollection(collection);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("\n=================================================");
    console.log(`✅ MIGRATION COMPLETE in ${duration} seconds.`);
    console.log("=================================================");
    
    process.exit(0);
}

// Execute the script
runMigration().catch(err => {
    console.error("FATAL SCRIPT ERROR:", err);
    process.exit(1);
});
