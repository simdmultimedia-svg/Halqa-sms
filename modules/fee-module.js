/**
 * ========================================
 * CIC KANO FEE MODULE
 * ========================================
 * Handles:
 * - Service payment records (moved from Expenses Module)
 * - Discount processing (fixed/percentage)
 * - Payment workflow: Section → Class → Student → Services → Total → Payment
 * - Maximum 2 installments (First Payment, Second Payment)
 * - Firebase synchronization
 * ========================================
 */

const FeeModule = {
    /**
     * Payment statuses
     */
    paymentStatuses: {
        PENDING: 'pending',
        PARTIAL: 'partial',
        COMPLETED: 'completed',
        OVERDUE: 'overdue'
    },

    /**
     * Installment types
     */
    installmentTypes: {
        FULL: 'full',
        FIRST: 'first',
        SECOND: 'second'
    },

    /**
     * Payment methods
     */
    paymentMethods: {
        BANK_TRANSFER: 'Bank Transfer',
        CASH: 'Cash',
        CHECK: 'Check',
        MOBILE_MONEY: 'Mobile Money'
    },

    /**
     * Load student fee data
     */
    async loadStudentFeeData(studentID, db) {
        try {
            let feeRecord = null;

            if (typeof db.ref === 'function') {
                // Firebase Realtime Database
                const snapshot = await db.ref(`studentFees/${studentID}`).once('value');
                if (snapshot.exists()) {
                    feeRecord = snapshot.val();
                }
            } else if (typeof db.collection === 'function') {
                // Firestore
                const doc = await db.collection('studentFees').doc(studentID).get();
                if (doc.exists()) {
                    feeRecord = doc.data();
                }
            }

            return feeRecord || this.createEmptyFeeRecord(studentID);
        } catch (error) {
            console.error('Error loading student fee data:', error);
            return this.createEmptyFeeRecord(studentID);
        }
    },

    /**
     * Create empty fee record
     */
    createEmptyFeeRecord(studentID) {
        return {
            studentID: studentID,
            studentName: '',
            class: '',
            section: '',
            services: [],
            totalCharged: 0,
            totalDiscounts: 0,
            netAmount: 0,
            totalPaid: 0,
            balance: 0,
            paymentStatus: this.paymentStatuses.PENDING,
            installmentEnabled: false,
            firstPayment: {
                amount: 0,
                dueDate: '',
                status: 'unpaid',
                paidDate: '',
                paidAmount: 0
            },
            secondPayment: {
                amount: 0,
                dueDate: '',
                status: 'unpaid',
                paidDate: '',
                paidAmount: 0
            },
            paymentRecords: [],
            discounts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    },

    /**
     * Get all classes
     */
    async getAllClasses(db) {
        try {
            const classes = [];

            if (typeof db.ref === 'function') {
                // Firebase Realtime Database
                const snapshot = await db.ref('classes').once('value');
                if (snapshot.exists()) {
                    snapshot.forEach(childSnapshot => {
                        classes.push(childSnapshot.val());
                    });
                }
            } else if (typeof db.collection === 'function') {
                // Firestore
                const querySnapshot = await db.collection('classes').get();
                querySnapshot.forEach(doc => {
                    classes.push(doc.data());
                });
            }

            return classes;
        } catch (error) {
            console.error('Error fetching classes:', error);
            return [];
        }
    },

    /**
     * Get students by class
     */
    async getStudentsByClass(className, db) {
        try {
            const students = [];

            if (typeof db.ref === 'function') {
                // Firebase Realtime Database
                const snapshot = await db.ref('students').orderByChild('class').equalTo(className).once('value');
                if (snapshot.exists()) {
                    snapshot.forEach(childSnapshot => {
                        students.push(childSnapshot.val());
                    });
                }
            } else if (typeof db.collection === 'function') {
                // Firestore
                const querySnapshot = await db.collection('students')
                    .where('class', '==', className)
                    .get();
                
                querySnapshot.forEach(doc => {
                    students.push(doc.data());
                });
            }

            return students;
        } catch (error) {
            console.error('Error fetching students by class:', error);
            return [];
        }
    },

    /**
     * Get student services with charges
     */
    async getStudentServices(studentID, db) {
        try {
            const services = [];
            const feeRecord = await this.loadStudentFeeData(studentID, db);

            // Return services from student's admission or fee record
            return feeRecord.services || [];
        } catch (error) {
            console.error('Error fetching student services:', error);
            return [];
        }
    },

    /**
     * Calculate total fees for student
     */
    calculateStudentTotal(services) {
        return services.reduce((total, service) => {
            return total + (service.price || 0);
        }, 0);
    },

    /**
     * Apply discount to fee
     */
    async applyDiscount(studentID, discountData, db) {
        try {
            const validation = this.validateDiscountData(discountData);
            if (!validation.isValid) {
                return {
                    success: false,
                    errors: validation.errors
                };
            }

            let feeRecord = await this.loadStudentFeeData(studentID, db);

            // Calculate discount amount
            let discountAmount = 0;
            if (discountData.type === 'fixed') {
                discountAmount = discountData.amount || 0;
            } else if (discountData.type === 'percentage') {
                discountAmount = (feeRecord.totalCharged * discountData.percentage) / 100;
            }

            // Create discount record
            const discountRecord = {
                discountID: this.generateDiscountID(),
                type: discountData.type,
                amount: discountAmount,
                percentage: discountData.percentage || 0,
                description: discountData.description || '',
                appliedBy: discountData.appliedBy || 'admin',
                approvedBy: discountData.approvedBy || '',
                createdAt: new Date().toISOString()
            };

            // Update fee record
            feeRecord.discounts.push(discountRecord);
            feeRecord.totalDiscounts += discountAmount;
            feeRecord.netAmount = feeRecord.totalCharged - feeRecord.totalDiscounts;
            feeRecord.balance = feeRecord.netAmount - feeRecord.totalPaid;
            feeRecord.updatedAt = new Date().toISOString();

            // Save to Firebase
            if (db) {
                await this.saveFeeRecordToFirebase(db, feeRecord);
            }

            return {
                success: true,
                discountID: discountRecord.discountID,
                discountAmount: discountAmount,
                newNetAmount: feeRecord.netAmount,
                newBalance: feeRecord.balance
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

        if (!discountData.type || !['fixed', 'percentage'].includes(discountData.type)) {
            errors.push('Invalid discount type');
        }

        if (discountData.type === 'fixed') {
            if (!discountData.amount || discountData.amount <= 0) {
                errors.push('Fixed discount amount must be greater than 0');
            }
        } else if (discountData.type === 'percentage') {
            if (!discountData.percentage || discountData.percentage <= 0 || discountData.percentage > 100) {
                errors.push('Percentage must be between 0 and 100');
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    },

    /**
     * Process full payment
     */
    async processFullPayment(studentID, paymentData, db) {
        try {
            let feeRecord = await this.loadStudentFeeData(studentID, db);

            // Create payment record
            const paymentRecord = {
                paymentID: this.generatePaymentID(),
                amount: feeRecord.balance,
                paymentMethod: paymentData.paymentMethod || 'Bank Transfer',
                reference: paymentData.reference || '',
                installmentType: this.installmentTypes.FULL,
                recordedBy: paymentData.recordedBy || 'admin',
                status: 'completed',
                createdAt: new Date().toISOString()
            };

            // Update fee record
            feeRecord.paymentRecords.push(paymentRecord);
            feeRecord.totalPaid += paymentRecord.amount;
            feeRecord.balance = feeRecord.netAmount - feeRecord.totalPaid;
            feeRecord.paymentStatus = this.paymentStatuses.COMPLETED;
            feeRecord.updatedAt = new Date().toISOString();

            if (feeRecord.balance < 0) feeRecord.balance = 0;

            // Save to Firebase
            if (db) {
                await this.saveFeeRecordToFirebase(db, feeRecord);
            }

            return {
                success: true,
                paymentID: paymentRecord.paymentID,
                newBalance: feeRecord.balance,
                paymentStatus: feeRecord.paymentStatus
            };
        } catch (error) {
            console.error('Error processing full payment:', error);
            return {
                success: false,
                error: error.message
            };
        }
    },

    /**
     * Process installment payment (max 2 installments)
     */
    async processInstallmentPayment(studentID, installmentData, db) {
        try {
            let feeRecord = await this.loadStudentFeeData(studentID, db);

            // Validate installment setup
            if (!feeRecord.installmentEnabled) {
                return {
                    success: false,
                    error: 'Installment payment not enabled for this student'
                };
            }

            let installmentKey = null;
            if (installmentData.installmentNumber === 1) {
                installmentKey = 'firstPayment';
            } else if (installmentData.installmentNumber === 2) {
                installmentKey = 'secondPayment';
            } else {
                return {
                    success: false,
                    error: 'Only 2 installments are allowed'
                };
            }

            const installment = feeRecord[installmentKey];

            // Create payment record
            const paymentRecord = {
                paymentID: this.generatePaymentID(),
                amount: installmentData.amount || installment.amount,
                paymentMethod: installmentData.paymentMethod || 'Bank Transfer',
                reference: installmentData.reference || '',
                installmentType: installmentData.installmentNumber === 1 
                    ? this.installmentTypes.FIRST 
                    : this.installmentTypes.SECOND,
                installmentNumber: installmentData.installmentNumber,
                recordedBy: installmentData.recordedBy || 'admin',
                status: 'completed',
                createdAt: new Date().toISOString()
            };

            // Update fee record
            feeRecord.paymentRecords.push(paymentRecord);
            feeRecord.totalPaid += paymentRecord.amount;
            feeRecord[installmentKey].paidAmount += paymentRecord.amount;
            feeRecord[installmentKey].paidDate = new Date().toISOString();
            feeRecord[installmentKey].status = 'paid';
            feeRecord.balance = feeRecord.netAmount - feeRecord.totalPaid;

            // Update payment status
            if (feeRecord.totalPaid >= feeRecord.netAmount) {
                feeRecord.paymentStatus = this.paymentStatuses.COMPLETED;
            } else {
                feeRecord.paymentStatus = this.paymentStatuses.PARTIAL;
            }

            feeRecord.updatedAt = new Date().toISOString();
            if (feeRecord.balance < 0) feeRecord.balance = 0;

            // Save to Firebase
            if (db) {
                await this.saveFeeRecordToFirebase(db, feeRecord);
            }

            return {
                success: true,
                paymentID: paymentRecord.paymentID,
                newBalance: feeRecord.balance,
                paymentStatus: feeRecord.paymentStatus
            };
        } catch (error) {
            console.error('Error processing installment payment:', error);
            return {
                success: false,
                error: error.message
            };
        }
    },

    /**
     * Setup installment plan
     */
    async setupInstallmentPlan(studentID, installmentPlan, db) {
        try {
            let feeRecord = await this.loadStudentFeeData(studentID, db);

            // Divide net amount into 2 installments
            const firstAmount = installmentPlan.firstAmount || (feeRecord.netAmount / 2);
            const secondAmount = feeRecord.netAmount - firstAmount;

            feeRecord.installmentEnabled = true;
            feeRecord.firstPayment = {
                amount: firstAmount,
                dueDate: installmentPlan.firstDueDate || '',
                status: 'unpaid',
                paidDate: '',
                paidAmount: 0
            };
            feeRecord.secondPayment = {
                amount: secondAmount,
                dueDate: installmentPlan.secondDueDate || '',
                status: 'unpaid',
                paidDate: '',
                paidAmount: 0
            };
            feeRecord.paymentStatus = this.paymentStatuses.PENDING;
            feeRecord.updatedAt = new Date().toISOString();

            // Save to Firebase
            if (db) {
                await this.saveFeeRecordToFirebase(db, feeRecord);
            }

            return {
                success: true,
                installmentPlan: {
                    firstPayment: feeRecord.firstPayment,
                    secondPayment: feeRecord.secondPayment
                }
            };
        } catch (error) {
            console.error('Error setting up installment plan:', error);
            return {
                success: false,
                error: error.message
            };
        }
    },

    /**
     * Move service payment from Expenses Module to Fee Module
     */
    async recordServicePayment(studentID, servicePaymentData, db) {
        try {
            let feeRecord = await this.loadStudentFeeData(studentID, db);

            // Create service payment record
            const servicePaymentRecord = {
                servicePaymentID: this.generatePaymentID(),
                serviceName: servicePaymentData.serviceName || '',
                amount: servicePaymentData.amount || 0,
                paymentMethod: servicePaymentData.paymentMethod || 'Bank Transfer',
                reference: servicePaymentData.reference || '',
                recordedBy: servicePaymentData.recordedBy || 'admin',
                recordedAt: new Date().toISOString(),
                description: servicePaymentData.description || ''
            };

            // Update service in services array
            const serviceIndex = feeRecord.services.findIndex(s => s.name === servicePaymentData.serviceName);
            if (serviceIndex !== -1) {
                if (!feeRecord.services[serviceIndex].payments) {
                    feeRecord.services[serviceIndex].payments = [];
                }
                feeRecord.services[serviceIndex].payments.push(servicePaymentRecord);
            }

            feeRecord.updatedAt = new Date().toISOString();

            // Save to Firebase
            if (db) {
                await this.saveFeeRecordToFirebase(db, feeRecord);
            }

            return {
                success: true,
                servicePaymentID: servicePaymentRecord.servicePaymentID
            };
        } catch (error) {
            console.error('Error recording service payment:', error);
            return {
                success: false,
                error: error.message
            };
        }
    },

    /**
     * Generate payment ID
     */
    generatePaymentID() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        return `PAY-${timestamp}-${random}`;
    },

    /**
     * Generate discount ID
     */
    generateDiscountID() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        return `DISC-${timestamp}-${random}`;
    },

    /**
     * Save fee record to Firebase
     */
    async saveFeeRecordToFirebase(db, feeRecord) {
        try {
            if (typeof db.ref === 'function') {
                // Firebase Realtime Database
                await db.ref(`studentFees/${feeRecord.studentID}`).set(feeRecord);
            } else if (typeof db.collection === 'function') {
                // Firestore
                await db.collection('studentFees').doc(feeRecord.studentID).set(feeRecord);
            }
            return true;
        } catch (error) {
            console.error('Firebase save error:', error);
            throw error;
        }
    },

    /**
     * Get payment history
     */
    async getPaymentHistory(studentID, db) {
        try {
            const feeRecord = await this.loadStudentFeeData(studentID, db);
            return feeRecord.paymentRecords || [];
        } catch (error) {
            console.error('Error fetching payment history:', error);
            return [];
        }
    },

    /**
     * Generate fee report
     */
    async generateFeeReport(studentID, db) {
        try {
            const feeRecord = await this.loadStudentFeeData(studentID, db);

            return {
                studentID: feeRecord.studentID,
                studentName: feeRecord.studentName,
                class: feeRecord.class,
                section: feeRecord.section,
                totalCharged: feeRecord.totalCharged,
                totalDiscounts: feeRecord.totalDiscounts,
                netAmount: feeRecord.netAmount,
                totalPaid: feeRecord.totalPaid,
                balance: feeRecord.balance,
                paymentStatus: feeRecord.paymentStatus,
                installmentEnabled: feeRecord.installmentEnabled,
                firstPayment: feeRecord.firstPayment,
                secondPayment: feeRecord.secondPayment,
                paymentRecords: feeRecord.paymentRecords,
                discounts: feeRecord.discounts,
                generatedAt: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error generating fee report:', error);
            return null;
        }
    }
};

// Export for use in main application
if (typeof window !== 'undefined') {
    window.FeeModule = FeeModule;
}
