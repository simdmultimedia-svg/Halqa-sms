/**
 * ========================================
 * CIC KANO FAMILY LEDGER & DISCOUNT SYSTEM
 * ========================================
 * Handles:
 * - Fixed amount discounts
 * - Percentage discounts
 * - Auto-update outstanding balance
 * - Auto-update family ledger
 * - Auto-update student statements
 * - Multi-student family accounts
 * - Firebase synchronization
 * ========================================
 */

const FamilyLedgerSystem = {
    /**
     * Discount types
     */
    discountTypes: {
        FIXED: 'fixed',
        PERCENTAGE: 'percentage'
    },

    /**
     * Create or get family ledger
     */
    async getFamilyLedger(familyID, db) {
        try {
            let ledger = null;

            if (typeof db.ref === 'function') {
                // Firebase Realtime Database
                const snapshot = await db.ref(`familyLedgers/${familyID}`).once('value');
                if (snapshot.exists()) {
                    ledger = snapshot.val();
                }
            } else if (typeof db.collection === 'function') {
                // Firestore
                const doc = await db.collection('familyLedgers').doc(familyID).get();
                if (doc.exists()) {
                    ledger = doc.data();
                }
            }

            return ledger || this.createEmptyLedger(familyID);
        } catch (error) {
            console.error('Error fetching family ledger:', error);
            return this.createEmptyLedger(familyID);
        }
    },

    /**
     * Create empty ledger structure
     */
    createEmptyLedger(familyID) {
        return {
            familyID: familyID,
            parentName: '',
            parentPhone: '',
            students: [], // Array of student IDs linked to this family
            totalCharged: 0,
            totalDiscounts: 0,
            totalPaid: 0,
            outstandingBalance: 0,
            discounts: [], // Array of discount records
            payments: [], // Array of payment records
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    },

    /**
     * Apply discount to family
     */
    async applyDiscount(familyID, discountData, db) {
        try {
            // Validate discount data
            const validation = this.validateDiscountData(discountData);
            if (!validation.isValid) {
                return {
                    success: false,
                    errors: validation.errors
                };
            }

            // Get current family ledger
            let ledger = await this.getFamilyLedger(familyID, db);

            // Calculate discount amount
            let discountAmount = 0;
            if (discountData.type === this.discountTypes.FIXED) {
                discountAmount = discountData.amount || 0;
            } else if (discountData.type === this.discountTypes.PERCENTAGE) {
                const percentage = discountData.percentage || 0;
                discountAmount = (ledger.outstandingBalance * percentage) / 100;
            }

            // Create discount record
            const discountRecord = {
                discountID: this.generateDiscountID(),
                type: discountData.type,
                amount: discountAmount,
                percentage: discountData.percentage || 0,
                description: discountData.description || '',
                reason: discountData.reason || '',
                appliedTo: discountData.appliedTo || 'all', // 'all' students or specific studentID
                appliedBy: discountData.appliedBy || 'admin',
                approvedBy: discountData.approvedBy || '',
                status: 'active',
                createdAt: new Date().toISOString(),
                effectiveDate: discountData.effectiveDate || new Date().toISOString()
            };

            // Update ledger
            ledger.discounts.push(discountRecord);
            ledger.totalDiscounts += discountAmount;
            ledger.outstandingBalance -= discountAmount;
            ledger.updatedAt = new Date().toISOString();

            // Ensure balance doesn't go negative
            if (ledger.outstandingBalance < 0) {
                ledger.outstandingBalance = 0;
            }

            // Save to Firebase
            if (db) {
                await this.saveLedgerToFirebase(db, ledger);
            }

            // Update all student statements
            await this.updateStudentStatementsForFamily(familyID, ledger, db);

            return {
                success: true,
                discountID: discountRecord.discountID,
                discountAmount: discountAmount,
                newBalance: ledger.outstandingBalance,
                ledger: ledger
            };
        } catch (error) {
            console.error('Error applying discount:', error);
            return {
                success: false,
                error: error.message
            };
        }
    },

    /**
     * Validate discount data
     */
    validateDiscountData(discountData) {
        const errors = [];

        if (!discountData.type || !Object.values(this.discountTypes).includes(discountData.type)) {
            errors.push('Invalid discount type');
        }

        if (discountData.type === this.discountTypes.FIXED) {
            if (!discountData.amount || discountData.amount <= 0) {
                errors.push('Fixed discount amount must be greater than 0');
            }
        } else if (discountData.type === this.discountTypes.PERCENTAGE) {
            if (!discountData.percentage || discountData.percentage <= 0 || discountData.percentage > 100) {
                errors.push('Percentage must be between 0 and 100');
            }
        }

        if (!discountData.description || discountData.description.trim() === '') {
            errors.push('Discount description is required');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    },

    /**
     * Generate unique discount ID
     */
    generateDiscountID() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        return `DISC-${timestamp}-${random}`;
    },

    /**
     * Record payment to family ledger
     */
    async recordPayment(familyID, paymentData, db) {
        try {
            // Get current family ledger
            let ledger = await this.getFamilyLedger(familyID, db);

            // Create payment record
            const paymentRecord = {
                paymentID: this.generatePaymentID(),
                amount: paymentData.amount || 0,
                paymentMethod: paymentData.paymentMethod || 'Bank Transfer',
                reference: paymentData.reference || '',
                description: paymentData.description || '',
                recordedBy: paymentData.recordedBy || 'admin',
                status: 'completed',
                createdAt: new Date().toISOString()
            };

            // Update ledger
            ledger.payments.push(paymentRecord);
            ledger.totalPaid += paymentData.amount;
            ledger.outstandingBalance -= paymentData.amount;
            ledger.updatedAt = new Date().toISOString();

            // Ensure balance doesn't go negative
            if (ledger.outstandingBalance < 0) {
                ledger.outstandingBalance = 0;
            }

            // Save to Firebase
            if (db) {
                await this.saveLedgerToFirebase(db, ledger);
            }

            // Update all student statements
            await this.updateStudentStatementsForFamily(familyID, ledger, db);

            return {
                success: true,
                paymentID: paymentRecord.paymentID,
                newBalance: ledger.outstandingBalance,
                ledger: ledger
            };
        } catch (error) {
            console.error('Error recording payment:', error);
            return {
                success: false,
                error: error.message
            };
        }
    },

    /**
     * Generate unique payment ID
     */
    generatePaymentID() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        return `PAY-${timestamp}-${random}`;
    },

    /**
     * Save ledger to Firebase
     */
    async saveLedgerToFirebase(db, ledger) {
        try {
            if (typeof db.ref === 'function') {
                // Firebase Realtime Database
                await db.ref(`familyLedgers/${ledger.familyID}`).set(ledger);
            } else if (typeof db.collection === 'function') {
                // Firestore
                await db.collection('familyLedgers').doc(ledger.familyID).set(ledger);
            }
            return true;
        } catch (error) {
            console.error('Firebase save error:', error);
            throw error;
        }
    },

    /**
     * Update student statements when family ledger changes
     */
    async updateStudentStatementsForFamily(familyID, ledger, db) {
        try {
            // Get all students linked to this family
            for (const studentID of ledger.students) {
                await this.updateStudentStatement(studentID, ledger, db);
            }
            return true;
        } catch (error) {
            console.error('Error updating student statements:', error);
            return false;
        }
    },

    /**
     * Update individual student statement
     */
    async updateStudentStatement(studentID, ledger, db) {
        try {
            const statement = {
                studentID: studentID,
                familyID: ledger.familyID,
                familyTotalCharged: ledger.totalCharged,
                familyTotalDiscounts: ledger.totalDiscounts,
                familyTotalPaid: ledger.totalPaid,
                familyOutstandingBalance: ledger.outstandingBalance,
                appliedDiscounts: ledger.discounts.filter(d => 
                    d.appliedTo === 'all' || d.appliedTo === studentID
                ),
                lastUpdated: new Date().toISOString()
            };

            if (typeof db.ref === 'function') {
                // Firebase Realtime Database
                await db.ref(`studentStatements/${studentID}`).set(statement);
            } else if (typeof db.collection === 'function') {
                // Firestore
                await db.collection('studentStatements').doc(studentID).set(statement, { merge: true });
            }

            return true;
        } catch (error) {
            console.error('Error updating student statement:', error);
            return false;
        }
    },

    /**
     * Get family financial summary
     */
    async getFamilyFinancialSummary(familyID, db) {
        try {
            const ledger = await this.getFamilyLedger(familyID, db);

            return {
                familyID: ledger.familyID,
                totalCharged: ledger.totalCharged,
                totalDiscounts: ledger.totalDiscounts,
                totalPaid: ledger.totalPaid,
                outstandingBalance: ledger.outstandingBalance,
                discountPercentage: ledger.totalCharged > 0 
                    ? ((ledger.totalDiscounts / ledger.totalCharged) * 100).toFixed(2) 
                    : 0,
                paymentPercentage: ledger.totalCharged > 0 
                    ? ((ledger.totalPaid / ledger.totalCharged) * 100).toFixed(2) 
                    : 0,
                studentCount: ledger.students.length,
                activeDiscounts: ledger.discounts.filter(d => d.status === 'active').length
            };
        } catch (error) {
            console.error('Error getting family financial summary:', error);
            return null;
        }
    },

    /**
     * Get discount history
     */
    async getDiscountHistory(familyID, db) {
        try {
            const ledger = await this.getFamilyLedger(familyID, db);
            return ledger.discounts || [];
        } catch (error) {
            console.error('Error getting discount history:', error);
            return [];
        }
    },

    /**
     * Get payment history
     */
    async getPaymentHistory(familyID, db) {
        try {
            const ledger = await this.getFamilyLedger(familyID, db);
            return ledger.payments || [];
        } catch (error) {
            console.error('Error getting payment history:', error);
            return [];
        }
    },

    /**
     * Link student to family
     */
    async linkStudentToFamily(studentID, familyID, db) {
        try {
            let ledger = await this.getFamilyLedger(familyID, db);

            // Add student if not already linked
            if (!ledger.students.includes(studentID)) {
                ledger.students.push(studentID);
                ledger.updatedAt = new Date().toISOString();

                // Save to Firebase
                if (db) {
                    await this.saveLedgerToFirebase(db, ledger);
                }
            }

            return {
                success: true,
                ledger: ledger
            };
        } catch (error) {
            console.error('Error linking student to family:', error);
            return {
                success: false,
                error: error.message
            };
        }
    },

    /**
     * Unlink student from family
     */
    async unlinkStudentFromFamily(studentID, familyID, db) {
        try {
            let ledger = await this.getFamilyLedger(familyID, db);

            // Remove student
            ledger.students = ledger.students.filter(id => id !== studentID);
            ledger.updatedAt = new Date().toISOString();

            // Save to Firebase
            if (db) {
                await this.saveLedgerToFirebase(db, ledger);
            }

            return {
                success: true,
                ledger: ledger
            };
        } catch (error) {
            console.error('Error unlinking student from family:', error);
            return {
                success: false,
                error: error.message
            };
        }
    },

    /**
     * Get all families for a student
     */
    async getStudentFamilies(studentID, db) {
        try {
            const families = [];

            if (typeof db.ref === 'function') {
                // Firebase Realtime Database
                const snapshot = await db.ref('familyLedgers').once('value');
                if (snapshot.exists()) {
                    snapshot.forEach(childSnapshot => {
                        const ledger = childSnapshot.val();
                        if (ledger.students && ledger.students.includes(studentID)) {
                            families.push(ledger);
                        }
                    });
                }
            } else if (typeof db.collection === 'function') {
                // Firestore
                const querySnapshot = await db.collection('familyLedgers')
                    .where('students', 'array-contains', studentID)
                    .get();
                
                querySnapshot.forEach(doc => {
                    families.push(doc.data());
                });
            }

            return families;
        } catch (error) {
            console.error('Error fetching student families:', error);
            return [];
        }
    },

    /**
     * Generate family financial report
     */
    async generateFamilyReport(familyID, db) {
        try {
            const ledger = await this.getFamilyLedger(familyID, db);
            const summary = await this.getFamilyFinancialSummary(familyID, db);

            return {
                family: ledger,
                summary: summary,
                discounts: ledger.discounts,
                payments: ledger.payments,
                generatedAt: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error generating family report:', error);
            return null;
        }
    }
};

// Export for use in main application
if (typeof window !== 'undefined') {
    window.FamilyLedgerSystem = FamilyLedgerSystem;
}
