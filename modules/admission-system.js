/**
 * ========================================
 * CIC KANO ADMISSION SYSTEM MODULE
 * ========================================
 * Handles:
 * - Four admission categories (Western, Islamiyyah, Tahfiz, Combined)
 * - Auto-assignment of services, fees, uniforms
 * - Student ID generation (CICK/YYYY/001 format)
 * - Firebase synchronization
 * ========================================
 */

const AdmissionSystem = {
    // Configuration database for each admission type
    categories: {
        western: {
            name: 'Western',
            description: 'English curriculum & science subjects',
            icon: 'ph-books',
            color: 'blue',
            subjects: ['Mathematics', 'English Language', 'Biology', 'Chemistry', 'Physics', 'Social Studies', 'History', 'Geography', 'Civics', 'French'],
            mandatoryServices: ['Tuition Fee', 'School Uniform', 'School Materials'],
            optionalServices: ['Sports Programme', 'ICT Laboratory', 'Library Card', 'Health Insurance', 'Bus Transport'],
            uniformOptions: {
                'Two Sets': { price: 15000, mandatory: true },
                'Three Sets': { price: 22000, mandatory: false },
                'Sports Wear': { price: 5000, optional: true }
            },
            fees: {
                tuition: 150000,
                schoolMaterial: 25000,
                uniform: 15000 // default
            }
        },
        islamiyyah: {
            name: 'Islamiyyah',
            description: 'Arabic & Islamic subjects only',
            icon: 'ph-star-and-crescent',
            color: 'green',
            subjects: ['Arabic Language', 'Islamic Studies', 'Qur\'an Recitation', 'Hadith', 'Fiqh', 'Islamic History', 'Arabic Literature', 'Mathematics', 'English Language'],
            mandatoryServices: ['Tuition Fee', 'School Uniform', 'School Materials', 'Islamic Books'],
            optionalServices: ['Quranic Circles', 'Islamic Camps', 'Library Card', 'Health Insurance', 'Bus Transport'],
            uniformOptions: {
                'Two Sets': { price: 12000, mandatory: true },
                'Three Sets': { price: 18000, mandatory: false },
                'Sports Wear': { price: 4000, optional: true }
            },
            fees: {
                tuition: 120000,
                schoolMaterial: 20000,
                islamicBooks: 15000,
                uniform: 12000 // default
            }
        },
        tahfiz: {
            name: 'Tahfiz',
            description: 'Qur\'an memorization & Tajweed',
            icon: 'ph-book-open-text',
            color: 'emerald',
            subjects: ['Qur\'an Memorization', 'Tajweed', 'Qur\'an Recitation', 'Islamic Studies', 'Arabic Language', 'Mathematics', 'English Language'],
            mandatoryServices: ['Tuition Fee', 'School Uniform', 'School Materials', 'Qur\'an Books & Resources'],
            optionalServices: ['Advanced Tajweed', 'Islamic Camps', 'Library Card', 'Health Insurance', 'Bus Transport'],
            uniformOptions: {
                'Two Sets': { price: 10000, mandatory: true },
                'Three Sets': { price: 16000, mandatory: false },
                'Sports Wear': { price: 3000, optional: true }
            },
            fees: {
                tuition: 100000,
                schoolMaterial: 15000,
                quranResources: 20000,
                uniform: 10000 // default
            }
        },
        combined: {
            name: 'Combined',
            description: 'Western + Islamiyyah + Tahfiz',
            icon: 'ph-circles-three-plus',
            color: 'purple',
            subjects: ['Mathematics', 'English Language', 'Biology', 'Chemistry', 'Physics', 'Arabic Language', 'Islamic Studies', 'Qur\'an Recitation', 'Social Studies', 'History'],
            mandatoryServices: ['Tuition Fee', 'School Uniform', 'School Materials', 'Islamic Books', 'Qur\'an Books & Resources'],
            optionalServices: ['Sports Programme', 'ICT Laboratory', 'Quranic Circles', 'Islamic Camps', 'Library Card', 'Health Insurance', 'Bus Transport'],
            uniformOptions: {
                'Two Sets': { price: 18000, mandatory: true },
                'Three Sets': { price: 25000, mandatory: false },
                'Sports Wear': { price: 6000, optional: true }
            },
            fees: {
                tuition: 200000,
                schoolMaterial: 30000,
                islamicBooks: 15000,
                quranResources: 20000,
                uniform: 18000 // default
            }
        }
    },

    // Service price database
    services: {
        // Mandatory Services
        'Tuition Fee': { price: 0, mandatory: true, category: 'academic' }, // varies by type
        'School Uniform': { price: 0, mandatory: true, category: 'uniform' }, // calculated
        'School Materials': { price: 0, mandatory: true, category: 'materials' }, // varies by type
        'Islamic Books': { price: 0, mandatory: false, category: 'books' },
        'Qur\'an Books & Resources': { price: 0, mandatory: false, category: 'books' },
        
        // Optional Services
        'Sports Programme': { price: 25000, mandatory: false, category: 'sports' },
        'ICT Laboratory': { price: 15000, mandatory: false, category: 'technology' },
        'Quranic Circles': { price: 20000, mandatory: false, category: 'religious' },
        'Islamic Camps': { price: 30000, mandatory: false, category: 'religious' },
        'Library Card': { price: 5000, mandatory: false, category: 'library' },
        'Health Insurance': { price: 35000, mandatory: false, category: 'health' },
        'Bus Transport': { price: 50000, mandatory: false, category: 'transport' }
    },

    /**
     * Get category configuration
     */
    getCategory(categoryName) {
        const key = categoryName.toLowerCase();
        return this.categories[key] || null;
    },

    /**
     * Get all mandatory services for a category
     */
    getMandatoryServices(categoryName) {
        const category = this.getCategory(categoryName);
        if (!category) return [];
        
        return category.mandatoryServices.map(serviceName => ({
            name: serviceName,
            price: this.getServicePrice(serviceName, categoryName),
            mandatory: true
        }));
    },

    /**
     * Get all optional services for a category
     */
    getOptionalServices(categoryName) {
        const category = this.getCategory(categoryName);
        if (!category) return [];
        
        return category.optionalServices.map(serviceName => ({
            name: serviceName,
            price: this.getServicePrice(serviceName, categoryName),
            mandatory: false
        }));
    },

    /**
     * Get service price based on category
     */
    getServicePrice(serviceName, categoryName) {
        const categoryKey = categoryName.toLowerCase();
        const category = this.categories[categoryKey];
        
        if (!category) return 0;

        // Handle category-specific pricing
        switch(serviceName) {
            case 'Tuition Fee':
                return category.fees.tuition || 0;
            case 'School Materials':
                return category.fees.schoolMaterial || 0;
            case 'Islamic Books':
                return category.fees.islamicBooks || 0;
            case 'Qur\'an Books & Resources':
                return category.fees.quranResources || 0;
            case 'School Uniform':
                return category.fees.uniform || 0;
            default:
                return this.services[serviceName]?.price || 0;
        }
    },

    /**
     * Get uniform options for a category
     */
    getUniformOptions(categoryName) {
        const category = this.getCategory(categoryName);
        if (!category) return {};
        return category.uniformOptions;
    },

    /**
     * Calculate total for selected services
     */
    calculateServicesTotal(selectedServices, categoryName) {
        return selectedServices.reduce((total, serviceName) => {
            return total + this.getServicePrice(serviceName, categoryName);
        }, 0);
    },

    /**
     * Calculate uniform total
     */
    calculateUniformTotal(uniformPackage, hasSportsWear, categoryName) {
        const category = this.getCategory(categoryName);
        if (!category) return 0;

        const options = category.uniformOptions;
        let total = options[uniformPackage]?.price || 0;
        
        if (hasSportsWear) {
            total += options['Sports Wear']?.price || 0;
        }
        
        return total;
    },

    /**
     * Generate Student ID (CICK/YYYY/001)
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
                const snapshot = await db.ref(`students/${year}`).orderByChild('studentIdNum').limitToLast(1).once('value');
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
                const querySnapshot = await db.collection('students')
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
            console.error('Error generating Student ID:', error);
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
     * Create admission record
     */
    async createAdmissionRecord(formData, categoryName, db) {
        try {
            // Generate student ID
            const idData = await this.generateStudentID(db);

            // Get category configuration
            const category = this.getCategory(categoryName);
            if (!category) throw new Error('Invalid admission category');

            // Parse selected services
            const selectedServices = formData.selectedServices || [];
            const servicesTotal = this.calculateServicesTotal(selectedServices, categoryName);

            // Calculate uniform total
            const uniformTotal = this.calculateUniformTotal(
                formData.uniformPackage || 'Two Sets',
                formData.hasSportsWear || false,
                categoryName
            );

            // Create admission record
            const admissionRecord = {
                // Student ID & Identity
                studentID: idData.studentID,
                studentIdNum: idData.studentIdNum,
                studentYear: idData.studentYear,
                
                // Personal Information
                fullName: formData.name || '',
                dateOfBirth: formData.dob || '',
                gender: formData.gender || '',
                photoData: formData.photoData || '',
                
                // Admission Information
                admissionType: categoryName,
                admissionDate: new Date().toISOString(),
                class: formData.class || '',
                section: formData.section || '',
                
                // Guardian Information
                parentName: formData.parent || '',
                parentPhone: formData.phone || '',
                parentEmail: formData.email || '',
                residentialAddress: formData.residentialAddress || '',
                
                // Health & Medical
                healthHistory: formData.healthHistory || '',
                medicalConditions: formData.medicalConditions || '',
                emergencyContact: formData.emergencyContact || '',
                
                // Services & Fees
                selectedServices: selectedServices,
                servicesTotal: servicesTotal,
                
                // Uniform Selection
                uniformPackage: formData.uniformPackage || 'Two Sets',
                hasSportsWear: formData.hasSportsWear || false,
                uniformTotal: uniformTotal,
                
                // Total Invoice Amount
                totalAmount: servicesTotal + uniformTotal,
                
                // Status
                status: 'active',
                admissionStatus: 'admitted',
                
                // Tahfiz-specific (if applicable)
                isTahfizStudent: formData.isTahfizStudent || false,
                tahfizLevel: formData.tahfizLevel || '',
                tahfizStatus: formData.tahfizStatus || '',
                tahfizJuz: formData.tahfizJuz || '',
                tahfizTeacher: formData.tahfizTeacher || '',
                tahfizRevision: formData.tahfizRevision || '',
                tahfizSurahs: formData.tahfizSurahs || '',
                
                // Metadata
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: formData.createdBy || 'admin',
                isOffline: idData.isOffline || false
            };

            // Save to Firebase
            if (db) {
                await this.saveToFirebase(db, admissionRecord);
            }

            return {
                success: true,
                studentID: idData.studentID,
                record: admissionRecord
            };
        } catch (error) {
            console.error('Error creating admission record:', error);
            return {
                success: false,
                error: error.message
            };
        }
    },

    /**
     * Save admission record to Firebase
     */
    async saveToFirebase(db, record) {
        try {
            if (typeof db.ref === 'function') {
                // Firebase Realtime Database
                await db.ref(`students/${record.studentYear}/${record.studentID}`).set(record);
            } else if (typeof db.collection === 'function') {
                // Firestore
                await db.collection('students').doc(record.studentID).set(record);
            }
            return true;
        } catch (error) {
            console.error('Firebase save error:', error);
            throw error;
        }
    },

    /**
     * Get student subjects based on admission type
     */
    getStudentSubjects(categoryName) {
        const category = this.getCategory(categoryName);
        if (!category) return [];
        return category.subjects;
    },

    /**
     * Verify admission data completeness
     */
    verifyAdmissionData(formData, categoryName) {
        const errors = [];

        if (!formData.name || formData.name.trim() === '') {
            errors.push('Full name is required');
        }
        if (!formData.dob) {
            errors.push('Date of birth is required');
        }
        if (!formData.gender) {
            errors.push('Gender is required');
        }
        if (!formData.parent || formData.parent.trim() === '') {
            errors.push('Parent/Guardian name is required');
        }
        if (!formData.phone || formData.phone.trim() === '') {
            errors.push('Parent phone is required');
        }
        if (!formData.class) {
            errors.push('Class selection is required');
        }
        if (!formData.selectedServices || formData.selectedServices.length === 0) {
            errors.push('At least one service must be selected');
        }

        // Tahfiz-specific validation
        if (categoryName.toLowerCase() === 'tahfiz' || formData.isTahfizStudent) {
            if (!formData.tahfizLevel) {
                errors.push('Tahfiz level is required for Tahfiz students');
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    },

    /**
     * Calculate total invoice amount
     */
    calculateInvoiceTotal(selectedServices, uniformPackage, hasSportsWear, categoryName) {
        const servicesTotal = this.calculateServicesTotal(selectedServices, categoryName);
        const uniformTotal = this.calculateUniformTotal(uniformPackage, hasSportsWear, categoryName);
        return {
            servicesTotal,
            uniformTotal,
            totalAmount: servicesTotal + uniformTotal
        };
    }
};

// Export for use in main application
if (typeof window !== 'undefined') {
    window.AdmissionSystem = AdmissionSystem;
}
