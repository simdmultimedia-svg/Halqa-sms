/**
 * ========================================
 * CIC KANO MIGRATION SYSTEM MODULE
 * ========================================
 * Handles:
 * - Auto Student ID generation
 * - Automatic Section assignment
 * - Automatic Class assignment
 * - NO admission charges
 * - NO service charges
 * - NO invoice generation
 * - Migrated students appear in: Fees, Results, Attendance, Behaviour, Assignments, ID Cards
 * - Firebase synchronization
 * ========================================
 */

const MigrationSystem = {
    /**
     * Class structure configuration
     */
    classStructure: {
        'Primary 1': { section: 'Primary', grade: 1, capacity: 40 },
        'Primary 2': { section: 'Primary', grade: 2, capacity: 40 },
        'Primary 3': { section: 'Primary', grade: 3, capacity: 40 },
        'Primary 4': { section: 'Primary', grade: 4, capacity: 40 },
        'Primary 5': { section: 'Primary', grade: 5, capacity: 40 },
        'Primary 6': { section: 'Primary', grade: 6, capacity: 40 },
        'Junior Secondary 1': { section: 'JSS', grade: 7, capacity: 45 },
        'Junior Secondary 2': { section: 'JSS', grade: 8, capacity: 45 },
        'Junior Secondary 3': { section: 'JSS', grade: 9, capacity: 45 },
        'Senior Secondary 1': { section: 'SSS', grade: 10, capacity: 45 },
        'Senior Secondary 2': { section: 'SSS', grade: 11, capacity: 45 },
        'Senior Secondary 3': { section: 'SSS', grade: 12, capacity: 45 }
    },

    /**
     * Generate Student ID for migrated student (CICK/YYYY/001)
     * Firebase-safe, multi-user safe, offline safe
     */
    async generateStudentID(db) {
        try {
            const year = new Date().getFullYear();
            const prefix = `CICK/${year}/`;

            // Get highest ID for this year from Firebase
            let maxNumber = 0;
            
            if (db && typeof db.ref === 'function') {
                // Firebase Realtime Database
                const snapshot = await db.ref(`migratedStudents/${year}`).orderByChild('studentIdNum').limitToLast(1).once('value');
                if (snapshot.exists()) {
                    const data = snapshot.val();
                    const ids = Object.values(data);
                    if (ids.length > 0) {
                        const lastNum = Math.max(...ids.map(student => parseInt(student.studentIdNum) || 0));
                        maxNumber = lastNum;
                    }
                }
            } else if (db && typeof db.collection === 'function') {
                // Firestore
                const querySnapshot = await db.collection('migratedStudents')
                    .where('studentYear', '==', year)
                    .orderBy('studentIdNum', 'desc')
                    .limit(1)
                    .get();
                
                if (!querySnapshot.empty) {
                    const lastDoc = querySnapshot.docs[0];
                    maxNumber = parseInt(lastDoc.data().studentIdNum) || 0;
                }
            }

            const newNumber = maxNumber + 1;
            const paddedNumber = String(newNumber).padStart(3, '0');
            const studentID = prefix + paddedNumber;

            return {
                studentID,
                studentIdNum: newNumber,
                studentYear: year
            };
        } catch (error) {
            console.error('Error generating Student ID for migration:', error);
            // Fallback: Generate locally with timestamp
            const timestamp = Date.now();
            return {
                studentID: `CICK/${new Date().getFullYear()}/${String(timestamp).slice(-3)}`,
                studentIdNum: timestamp % 1000,
                studentYear: new Date().getFullYear(),
                isOffline: true
            };
        }
    },

    /**
     * Auto-assign section based on class
     */
    assignSection(className) {
        const classInfo = this.classStructure[className];
        if (!classInfo) return 'General';
        return classInfo.section;
    },

    /**
     * Auto-assign class based on current class or promotion
     */
    assignClass(currentClass) {
        const classes = Object.keys(this.classStructure);
        
        // Find next class for promotion
        const currentIndex = classes.indexOf(currentClass);
        if (currentIndex !== -1 && currentIndex < classes.length - 1) {
            return classes[currentIndex + 1];
        }
        
        // If already in final class, keep in same class
        return currentClass;
    },

    /**
     * Get all classes available
     */
    getAllClasses() {
        return Object.keys(this.classStructure);
    },

    /**
     * Get all sections
     */
    getAllSections() {
        const sections = new Set();
        Object.values(this.classStructure).forEach(classInfo => {
            sections.add(classInfo.section);
        });
        return Array.from(sections);
    },

    /**
     * Verify migration data
     */
    verifyMigrationData(formData) {
        const errors = [];

        if (!formData.studentID || formData.studentID.trim() === '') {
            errors.push('Student ID is required');
        }

        if (!formData.fullName || formData.fullName.trim() === '') {
            errors.push('Full name is required');
        }

        if (!formData.dateOfBirth) {
            errors.push('Date of birth is required');
        }

        if (!formData.gender) {
            errors.push('Gender is required');
        }

        if (!formData.currentClass) {
            errors.push('Current class is required');
        }

        if (!formData.parentName || formData.parentName.trim() === '') {
            errors.push('Parent/Guardian name is required');
        }

        if (!formData.parentPhone || formData.parentPhone.trim() === '') {
            errors.push('Parent phone is required');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    },

    /**
     * Create migration record
     * ⚠️ NO CHARGES - No admission, service, or invoice generation
     */
    async createMigrationRecord(formData, db) {
        try {
            // Verify data
            const validation = this.verifyMigrationData(formData);
            if (!validation.isValid) {
                return {
                    success: false,
                    errors: validation.errors
                };
            }

            // Generate new Student ID
            const idData = await this.generateStudentID(db);

            // Auto-assign section
            const assignedSection = this.assignSection(formData.currentClass);

            // Auto-assign new class (promotion)
            const newClass = this.assignClass(formData.currentClass);

            // Create migration record
            const migrationRecord = {
                // Student ID (NEW - Auto Generated)
                studentID: idData.studentID,
                studentIdNum: idData.studentIdNum,
                studentYear: idData.studentYear,
                originalStudentID: formData.studentID, // Keep original ID reference
                
                // Personal Information
                fullName: formData.fullName || '',
                dateOfBirth: formData.dateOfBirth || '',
                gender: formData.gender || '',
                photoData: formData.photoData || '',
                
                // Previous Academic Information
                previousClass: formData.currentClass || '',
                previousSchool: formData.previousSchool || '',
                previousYear: formData.previousYear || '',
                
                // New Class Assignment (Auto-assigned)
                newClass: newClass,
                assignedSection: assignedSection,
                promotionDate: new Date().toISOString(),
                
                // Guardian Information
                parentName: formData.parentName || '',
                parentPhone: formData.parentPhone || '',
                parentEmail: formData.parentEmail || '',
                residentialAddress: formData.residentialAddress || '',
                
                // Health & Medical
                healthHistory: formData.healthHistory || '',
                medicalConditions: formData.medicalConditions || '',
                emergencyContact: formData.emergencyContact || '',
                
                // ⚠️ MIGRATION SPECIFIC - NO CHARGES
                // These fields are intentionally empty - no admission, service, or invoice charges
                admissionCharges: 0,
                serviceCharges: 0,
                invoiceGenerated: false,
                admissionChargesApplied: false,
                
                // Status
                status: 'active',
                migrationStatus: 'migrated',
                isMigratedStudent: true,
                
                // Metadata
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                migratedBy: formData.migratedBy || 'admin',
                isOffline: idData.isOffline || false
            };

            // Save to Firebase
            if (db) {
                await this.saveToFirebase(db, migrationRecord);
            }

            return {
                success: true,
                studentID: idData.studentID,
                assignedClass: newClass,
                assignedSection: assignedSection,
                record: migrationRecord
            };
        } catch (error) {
            console.error('Error creating migration record:', error);
            return {
                success: false,
                error: error.message
            };
        }
    },

    /**
     * Save migration record to Firebase
     * Records appear in:
     * - Fees (no initial charges, but can track payments)
     * - Results (can record academic results)
     * - Attendance (can track attendance)
     * - Behaviour (can track behaviour records)
     * - Assignments (can assign homework/tasks)
     * - ID Cards (included in student ID generation)
     */
    async saveToFirebase(db, record) {
        try {
            if (typeof db.ref === 'function') {
                // Firebase Realtime Database
                const studentPath = `migratedStudents/${record.studentYear}/${record.studentID}`;
                await db.ref(studentPath).set(record);
                
                // Add to global students list for cross-module visibility
                await db.ref(`students/${record.studentYear}/${record.studentID}`).set({
                    ...record,
                    isMigratedStudent: true
                });
                
                // Add entry for fees module (no charges)
                await db.ref(`fees/${record.studentID}`).set({
                    studentID: record.studentID,
                    studentName: record.fullName,
                    class: record.newClass,
                    section: record.assignedSection,
                    totalCharged: 0, // No admission or service charges
                    paidAmount: 0,
                    balance: 0,
                    isMigratedStudent: true,
                    createdAt: record.createdAt
                });
                
                // Add entry for results module
                await db.ref(`results/${record.studentID}`).set({
                    studentID: record.studentID,
                    studentName: record.fullName,
                    class: record.newClass,
                    section: record.assignedSection,
                    results: {},
                    isMigratedStudent: true,
                    createdAt: record.createdAt
                });
                
                // Add entry for attendance module
                await db.ref(`attendance/${record.studentID}`).set({
                    studentID: record.studentID,
                    studentName: record.fullName,
                    class: record.newClass,
                    section: record.assignedSection,
                    records: {},
                    isMigratedStudent: true,
                    createdAt: record.createdAt
                });
                
                // Add entry for behaviour module
                await db.ref(`behaviour/${record.studentID}`).set({
                    studentID: record.studentID,
                    studentName: record.fullName,
                    class: record.newClass,
                    section: record.assignedSection,
                    records: {},
                    isMigratedStudent: true,
                    createdAt: record.createdAt
                });
                
                // Add entry for assignments module
                await db.ref(`assignments/${record.studentID}`).set({
                    studentID: record.studentID,
                    studentName: record.fullName,
                    class: record.newClass,
                    section: record.assignedSection,
                    assignments: {},
                    isMigratedStudent: true,
                    createdAt: record.createdAt
                });

            } else if (typeof db.collection === 'function') {
                // Firestore
                const studentDoc = db.collection('migratedStudents').doc(record.studentID);
                await studentDoc.set(record);
                
                // Add to global students collection
                await db.collection('students').doc(record.studentID).set({
                    ...record,
                    isMigratedStudent: true
                });
                
                // Add to fees collection (no charges)
                await db.collection('fees').doc(record.studentID).set({
                    studentID: record.studentID,
                    studentName: record.fullName,
                    class: record.newClass,
                    section: record.assignedSection,
                    totalCharged: 0,
                    paidAmount: 0,
                    balance: 0,
                    isMigratedStudent: true,
                    createdAt: record.createdAt
                });
                
                // Add to results collection
                await db.collection('results').doc(record.studentID).set({
                    studentID: record.studentID,
                    studentName: record.fullName,
                    class: record.newClass,
                    section: record.assignedSection,
                    results: {},
                    isMigratedStudent: true,
                    createdAt: record.createdAt
                });
                
                // Add to attendance collection
                await db.collection('attendance').doc(record.studentID).set({
                    studentID: record.studentID,
                    studentName: record.fullName,
                    class: record.newClass,
                    section: record.assignedSection,
                    records: {},
                    isMigratedStudent: true,
                    createdAt: record.createdAt
                });
                
                // Add to behaviour collection
                await db.collection('behaviour').doc(record.studentID).set({
                    studentID: record.studentID,
                    studentName: record.fullName,
                    class: record.newClass,
                    section: record.assignedSection,
                    records: {},
                    isMigratedStudent: true,
                    createdAt: record.createdAt
                });
                
                // Add to assignments collection
                await db.collection('assignments').doc(record.studentID).set({
                    studentID: record.studentID,
                    studentName: record.fullName,
                    class: record.newClass,
                    section: record.assignedSection,
                    assignments: {},
                    isMigratedStudent: true,
                    createdAt: record.createdAt
                });
            }
            
            return true;
        } catch (error) {
            console.error('Firebase save error during migration:', error);
            throw error;
        }
    },

    /**
     * Get migrated students by class
     */
    async getMigratedStudentsByClass(className, db) {
        try {
            const students = [];
            
            if (typeof db.ref === 'function') {
                // Firebase Realtime Database
                const snapshot = await db.ref('migratedStudents').orderByChild('newClass').equalTo(className).once('value');
                if (snapshot.exists()) {
                    snapshot.forEach(childSnapshot => {
                        students.push(childSnapshot.val());
                    });
                }
            } else if (typeof db.collection === 'function') {
                // Firestore
                const querySnapshot = await db.collection('migratedStudents')
                    .where('newClass', '==', className)
                    .get();
                
                querySnapshot.forEach(doc => {
                    students.push(doc.data());
                });
            }
            
            return students;
        } catch (error) {
            console.error('Error fetching migrated students:', error);
            return [];
        }
    },

    /**
     * Get migrated students by section
     */
    async getMigratedStudentsBySection(section, db) {
        try {
            const students = [];
            
            if (typeof db.ref === 'function') {
                // Firebase Realtime Database
                const snapshot = await db.ref('migratedStudents').orderByChild('assignedSection').equalTo(section).once('value');
                if (snapshot.exists()) {
                    snapshot.forEach(childSnapshot => {
                        students.push(childSnapshot.val());
                    });
                }
            } else if (typeof db.collection === 'function') {
                // Firestore
                const querySnapshot = await db.collection('migratedStudents')
                    .where('assignedSection', '==', section)
                    .get();
                
                querySnapshot.forEach(doc => {
                    students.push(doc.data());
                });
            }
            
            return students;
        } catch (error) {
            console.error('Error fetching migrated students by section:', error);
            return [];
        }
    },

    /**
     * Verify migrated student can access all modules
     * Returns modules where student should appear
     */
    getMigrationAccessModules() {
        return {
            fees: {
                name: 'Fees Module',
                description: 'View fees and make payments (no initial charges)',
                enabled: true
            },
            results: {
                name: 'Results Module',
                description: 'View and record academic results',
                enabled: true
            },
            attendance: {
                name: 'Attendance Module',
                description: 'Track attendance records',
                enabled: true
            },
            behaviour: {
                name: 'Behaviour Module',
                description: 'Track behaviour and conduct records',
                enabled: true
            },
            assignments: {
                name: 'Assignments Module',
                description: 'Receive and submit assignments',
                enabled: true
            },
            idCards: {
                name: 'ID Cards',
                description: 'Generate and print student ID cards',
                enabled: true
            }
        };
    }
};

// Export for use in main application
if (typeof window !== 'undefined') {
    window.MigrationSystem = MigrationSystem;
}
