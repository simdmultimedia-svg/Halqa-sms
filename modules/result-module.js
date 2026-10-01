/**
 * ========================================
 * CIC KANO RESULT MODULE
 * ========================================
 * Handles:
 * - Section-specific results (Western, Islamiyyah, Tahfiz)
 * - Each section has own subjects, grading rules, teacher assignments
 * - Result card generation
 * - A4 printing without cut-off
 * - School logo watermark
 * - School motto display: "Splendor of a Better Tomorrow"
 * - Firebase synchronization
 * ========================================
 */

const ResultModule = {
    /**
     * School information
     */
    school: {
        name: 'CIC KANO',
        fullName: 'Companions International College Kano',
        motto: 'Splendor of a Better Tomorrow',
        address: 'Kano, Nigeria'
    },

    /**
     * Section-specific configurations
     */
    sections: {
        western: {
            name: 'Western',
            subjects: [
                'Mathematics',
                'English Language',
                'Biology',
                'Chemistry',
                'Physics',
                'Social Studies',
                'History',
                'Geography',
                'Civics',
                'French',
                'Information & Communication Technology',
                'Fine Arts'
            ],
            gradeScale: {
                A: { min: 80, max: 100, points: 5 },
                B: { min: 70, max: 79, points: 4 },
                C: { min: 60, max: 69, points: 3 },
                D: { min: 50, max: 59, points: 2 },
                E: { min: 40, max: 49, points: 1 },
                F: { min: 0, max: 39, points: 0 }
            },
            passGrade: 'D',
            gradeRules: 'CA: 40%, Exam: 60%'
        },
        islamiyyah: {
            name: 'Islamiyyah',
            subjects: [
                'Arabic Language',
                'Islamic Studies',
                'Qur\'an Recitation',
                'Hadith',
                'Fiqh',
                'Islamic History',
                'Arabic Literature',
                'Mathematics',
                'English Language'
            ],
            gradeScale: {
                A: { min: 80, max: 100, points: 5 },
                B: { min: 70, max: 79, points: 4 },
                C: { min: 60, max: 69, points: 3 },
                D: { min: 50, max: 59, points: 2 },
                E: { min: 40, max: 49, points: 1 },
                F: { min: 0, max: 39, points: 0 }
            },
            passGrade: 'D',
            gradeRules: 'CA: 40%, Exam: 60%'
        },
        tahfiz: {
            name: 'Tahfiz',
            subjects: [
                'Qur\'an Memorization',
                'Tajweed',
                'Qur\'an Recitation',
                'Islamic Studies',
                'Arabic Language',
                'Mathematics',
                'English Language'
            ],
            gradeScale: {
                A: { min: 80, max: 100, points: 5 },
                B: { min: 70, max: 79, points: 4 },
                C: { min: 60, max: 69, points: 3 },
                D: { min: 50, max: 59, points: 2 },
                E: { min: 40, max: 49, points: 1 },
                F: { min: 0, max: 39, points: 0 }
            },
            passGrade: 'D',
            gradeRules: 'CA: 40%, Exam: 60%'
        }
    },

    /**
     * Get section configuration
     */
    getSectionConfig(sectionName) {
        const key = sectionName.toLowerCase();
        return this.sections[key] || null;
    },

    /**
     * Get subjects for a section
     */
    getSectionSubjects(sectionName) {
        const config = this.getSectionConfig(sectionName);
        return config ? config.subjects : [];
    },

    /**
     * Get grade scale for a section
     */
    getGradeScale(sectionName) {
        const config = this.getSectionConfig(sectionName);
        return config ? config.gradeScale : {};
    },

    /**
     * Calculate total score (CA + Exam)
     */
    calculateTotalScore(caScore, examScore) {
        const ca = parseFloat(caScore) || 0;
        const exam = parseFloat(examScore) || 0;
        return ca + exam;
    },

    /**
     * Get grade from total score
     */
    getGrade(totalScore, sectionName) {
        const gradeScale = this.getGradeScale(sectionName);
        
        for (const [grade, range] of Object.entries(gradeScale)) {
            if (totalScore >= range.min && totalScore <= range.max) {
                return {
                    grade: grade,
                    points: range.points,
                    passed: grade !== 'F'
                };
            }
        }
        
        return {
            grade: 'F',
            points: 0,
            passed: false
        };
    },

    /**
     * Create result record
     */
    async createResultRecord(resultData, db) {
        try {
            // Validate result data
            const validation = this.validateResultData(resultData);
            if (!validation.isValid) {
                return {
                    success: false,
                    errors: validation.errors
                };
            }

            // Get section configuration
            const sectionConfig = this.getSectionConfig(resultData.section);
            if (!sectionConfig) {
                return {
                    success: false,
                    error: 'Invalid section'
                };
            }

            // Calculate total score and grade
            const totalScore = this.calculateTotalScore(resultData.caScore, resultData.examScore);
            const gradeInfo = this.getGrade(totalScore, resultData.section);

            // Create result record
            const resultRecord = {
                resultID: this.generateResultID(),
                studentID: resultData.studentID,
                studentName: resultData.studentName,
                class: resultData.class,
                section: resultData.section,
                session: resultData.session,
                term: resultData.term,
                subject: resultData.subject,
                caScore: parseFloat(resultData.caScore) || 0,
                examScore: parseFloat(resultData.examScore) || 0,
                totalScore: totalScore,
                grade: gradeInfo.grade,
                points: gradeInfo.points,
                passed: gradeInfo.passed,
                teacherName: resultData.teacherName || '',
                teacherID: resultData.teacherID || '',
                remarks: resultData.remarks || '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: resultData.createdBy || 'admin'
            };

            // Save to Firebase
            if (db) {
                await this.saveResultToFirebase(db, resultRecord);
            }

            return {
                success: true,
                resultID: resultRecord.resultID,
                record: resultRecord
            };
        } catch (error) {
            console.error('Error creating result record:', error);
            return {
                success: false,
                error: error.message
            };
        }
    },

    /**
     * Validate result data
     */
    validateResultData(resultData) {
        const errors = [];

        if (!resultData.studentID || resultData.studentID.trim() === '') {
            errors.push('Student ID is required');
        }
        if (!resultData.studentName || resultData.studentName.trim() === '') {
            errors.push('Student name is required');
        }
        if (!resultData.class || resultData.class.trim() === '') {
            errors.push('Class is required');
        }
        if (!resultData.section || resultData.section.trim() === '') {
            errors.push('Section is required');
        }
        if (!resultData.session || resultData.session.trim() === '') {
            errors.push('Session is required');
        }
        if (!resultData.term || resultData.term.trim() === '') {
            errors.push('Term is required');
        }
        if (!resultData.subject || resultData.subject.trim() === '') {
            errors.push('Subject is required');
        }
        if (isNaN(resultData.caScore) || resultData.caScore < 0 || resultData.caScore > 40) {
            errors.push('CA score must be between 0 and 40');
        }
        if (isNaN(resultData.examScore) || resultData.examScore < 0 || resultData.examScore > 60) {
            errors.push('Exam score must be between 0 and 60');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    },

    /**
     * Generate result ID
     */
    generateResultID() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        return `RES-${timestamp}-${random}`;
    },

    /**
     * Save result to Firebase
     */
    async saveResultToFirebase(db, resultRecord) {
        try {
            if (typeof db.ref === 'function') {
                // Firebase Realtime Database
                await db.ref(`results/${resultRecord.studentID}/${resultRecord.resultID}`).set(resultRecord);
            } else if (typeof db.collection === 'function') {
                // Firestore
                await db.collection('results').doc(resultRecord.resultID).set(resultRecord);
            }
            return true;
        } catch (error) {
            console.error('Firebase save error:', error);
            throw error;
        }
    },

    /**
     * Get student results
     */
    async getStudentResults(studentID, session, term, db) {
        try {
            const results = [];

            if (typeof db.ref === 'function') {
                // Firebase Realtime Database
                const snapshot = await db.ref(`results/${studentID}`).once('value');
                if (snapshot.exists()) {
                    snapshot.forEach(childSnapshot => {
                        const result = childSnapshot.val();
                        if (result.session === session && result.term === term) {
                            results.push(result);
                        }
                    });
                }
            } else if (typeof db.collection === 'function') {
                // Firestore
                const querySnapshot = await db.collection('results')
                    .where('studentID', '==', studentID)
                    .where('session', '==', session)
                    .where('term', '==', term)
                    .get();
                
                querySnapshot.forEach(doc => {
                    results.push(doc.data());
                });
            }

            return results;
        } catch (error) {
            console.error('Error fetching student results:', error);
            return [];
        }
    },

    /**
     * Calculate GPA
     */
    calculateGPA(results) {
        if (results.length === 0) return 0;

        const totalPoints = results.reduce((sum, result) => sum + result.points, 0);
        const gpa = (totalPoints / results.length).toFixed(2);
        
        return parseFloat(gpa);
    },

    /**
     * Generate report card HTML (A4 compatible)
     */
    generateReportCardHTML(studentData, results, logoUrl) {
        const gpa = this.calculateGPA(results);
        const passCount = results.filter(r => r.passed).length;
        const totalSubjects = results.length;

        const html = `
        <div class="report-card cic-pdf-style">
            <!-- HEADER WITH LOGO AND SCHOOL INFO -->
            <table class="header-table">
                <tr>
                    <td style="text-align:center;width:20%;">
                        <img src="${logoUrl}" alt="School Logo" class="school-logo">
                    </td>
                    <td style="text-align:center;width:60%;padding:0 2rem;">
                        <h1>${this.school.fullName}</h1>
                        <div class="school-address">${this.school.address}</div>
                        <div style="margin-top:0.5rem;font-size:0.85rem;font-style:italic;">"${this.school.motto}"</div>
                    </td>
                    <td style="text-align:center;width:20%;">
                        <img src="${logoUrl}" alt="Watermark" class="school-logo" style="opacity:0.3;">
                    </td>
                </tr>
            </table>

            <!-- REPORT CARD TITLE -->
            <div class="report-title">ACADEMIC RESULT CARD</div>

            <!-- STUDENT INFORMATION -->
            <table class="student-info-table" style="width:100%;margin-bottom:1rem;">
                <tr>
                    <td style="font-weight:800;width:25%;">Student Name:</td>
                    <td style="width:75%;">${studentData.fullName}</td>
                </tr>
                <tr>
                    <td style="font-weight:800;">Student ID:</td>
                    <td>${studentData.studentID}</td>
                </tr>
                <tr>
                    <td style="font-weight:800;">Class:</td>
                    <td>${studentData.class}</td>
                </tr>
                <tr>
                    <td style="font-weight:800;">Session:</td>
                    <td>${results[0]?.session || ''}</td>
                </tr>
                <tr>
                    <td style="font-weight:800;">Term:</td>
                    <td>${results[0]?.term || ''}</td>
                </tr>
            </table>

            <!-- RESULTS TABLE -->
            <table class="result-table">
                <thead>
                    <tr>
                        <th>Subject</th>
                        <th>CA (40)</th>
                        <th>Exam (60)</th>
                        <th>Total</th>
                        <th>Grade</th>
                        <th>Remark</th>
                    </tr>
                </thead>
                <tbody>
                    ${results.map(result => `
                        <tr>
                            <td style="text-align:left;">${result.subject}</td>
                            <td>${result.caScore}</td>
                            <td>${result.examScore}</td>
                            <td>${result.totalScore}</td>
                            <td style="font-weight:800;${result.grade === 'F' ? 'color:#dc2626;' : ''}">${result.grade}</td>
                            <td>${result.passed ? 'Pass' : 'Fail'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <!-- SUMMARY -->
            <div class="grade-details">
                <div><strong>GPA:</strong> ${gpa}</div>
                <div><strong>Subjects Passed:</strong> ${passCount}/${totalSubjects}</div>
                <div><strong>Overall Status:</strong> ${passCount === totalSubjects ? 'PROMOTED' : 'REVIEW REQUIRED'}</div>
            </div>

            <!-- SIGNATURES -->
            <div class="signature-row">
                <div class="signature-line">
                    Form Tutor<br>
                    Date: ___________
                </div>
                <div class="signature-line">
                    Head of Department<br>
                    Date: ___________
                </div>
                <div class="signature-line">
                    Principal<br>
                    Date: ___________
                </div>
            </div>

            <!-- MOTTO FOOTER -->
            <div style="text-align:center;margin-top:1rem;padding-top:1rem;border-top:1px solid #111;font-size:0.85rem;font-style:italic;">
                "${this.school.motto}"
            </div>
        </div>
        `;

        return html;
    },

    /**
     * Get all teacher assignments for a subject in a section
     */
    async getTeacherAssignments(subject, section, db) {
        try {
            const assignments = [];

            if (typeof db.ref === 'function') {
                // Firebase Realtime Database
                const snapshot = await db.ref('teacherAssignments').orderByChild('subject').equalTo(subject).once('value');
                if (snapshot.exists()) {
                    snapshot.forEach(childSnapshot => {
                        const assignment = childSnapshot.val();
                        if (assignment.section === section) {
                            assignments.push(assignment);
                        }
                    });
                }
            } else if (typeof db.collection === 'function') {
                // Firestore
                const querySnapshot = await db.collection('teacherAssignments')
                    .where('subject', '==', subject)
                    .where('section', '==', section)
                    .get();
                
                querySnapshot.forEach(doc => {
                    assignments.push(doc.data());
                });
            }

            return assignments;
        } catch (error) {
            console.error('Error fetching teacher assignments:', error);
            return [];
        }
    },

    /**
     * Get class statistics
     */
    async getClassStatistics(className, session, term, db) {
        try {
            const results = [];

            if (typeof db.ref === 'function') {
                // Firebase Realtime Database
                const snapshot = await db.ref('results').once('value');
                if (snapshot.exists()) {
                    snapshot.forEach(studentSnapshot => {
                        studentSnapshot.forEach(resultSnapshot => {
                            const result = resultSnapshot.val();
                            if (result.class === className && result.session === session && result.term === term) {
                                results.push(result);
                            }
                        });
                    });
                }
            } else if (typeof db.collection === 'function') {
                // Firestore
                const querySnapshot = await db.collection('results')
                    .where('class', '==', className)
                    .where('session', '==', session)
                    .where('term', '==', term)
                    .get();
                
                querySnapshot.forEach(doc => {
                    results.push(doc.data());
                });
            }

            // Calculate statistics
            const passCount = results.filter(r => r.passed).length;
            const failCount = results.filter(r => !r.passed).length;
            const highestScore = Math.max(...results.map(r => r.totalScore), 0);
            const lowestScore = Math.min(...results.map(r => r.totalScore), 0);
            const avgScore = (results.reduce((sum, r) => sum + r.totalScore, 0) / results.length).toFixed(2);

            return {
                totalResults: results.length,
                passCount,
                failCount,
                passRate: ((passCount / results.length) * 100).toFixed(2),
                highestScore,
                lowestScore,
                averageScore: parseFloat(avgScore)
            };
        } catch (error) {
            console.error('Error calculating class statistics:', error);
            return null;
        }
    }
};

// Export for use in main application
if (typeof window !== 'undefined') {
    window.ResultModule = ResultModule;
}
