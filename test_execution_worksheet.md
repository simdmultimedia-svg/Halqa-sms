# PRODUCTION ACCEPTANCE - TEST EXECUTION WORKSHEET

**Test Date:** _______________  
**Tester Name:** _______________  
**Environment:** ☐ Staging  ☐ Production  
**Firebase Project:** _______________  

---

## TEST 1: FIRST INSTALL BOOTSTRAP

### Prerequisites
- [ ] Empty Firebase project created
- [ ] Firestore enabled
- [ ] Authentication enabled
- [ ] Firebase config deployed to app

### Execution

```
Step 1: Initial State Check
  [ ] Go to Firebase Console → Firestore
  [ ] Verify: "users" collection DOES NOT exist
  [ ] Verify: "userRoles" collection DOES NOT exist
  
Step 2: First User Login
  [ ] Open app
  [ ] Sign in with: ________________
  [ ] Observe loading...
  
Step 3: Verify Auto-Bootstrap
  [ ] Check for error message: ___________
  [ ] Expected: NO error, dashboard loads
  [ ] Dashboard visible: ☐ Yes  ☐ No
  
Step 4: Verify Firebase Documents
  [ ] Go to Firebase Console → Firestore
  [ ] Find "users" collection: ☐ Yes  ☐ No
  [ ] Find "userRoles" collection: ☐ Yes  ☐ No
  [ ] Open users/{uid}:
      - uid: _______________
      - email: _______________
      - role: _______________
      - autoBootstrapped: ☐ true  ☐ false
      - createdAt: _______________
  [ ] Verify role = "Super Admin" (NOT "Student")
```

### Results

| Item | Expected | Actual | Pass |
|------|----------|--------|------|
| users collection created | Yes | ☐ Yes ☐ No | ☐ |
| userRoles collection created | Yes | ☐ Yes ☐ No | ☐ |
| role = "Super Admin" | Yes | ☐ Yes ☐ No | ☐ |
| No error message | Yes | ☐ Yes ☐ No | ☐ |
| Dashboard loads | Yes | ☐ Yes ☐ No | ☐ |

**Test 1 Result:** ☐ PASS  ☐ FAIL  
**Notes:** _______________________________________________

---

## TEST 2: ROLE HARDENING

### Prerequisites
- [ ] Super Admin account exists
- [ ] At least 5 test users (Super Admin, Admin, Teacher, Student, Accountant)

### Test 2A: Super Admin Dashboard

```
[ ] Sign in as: ________________ (Super Admin)
[ ] Dashboard title shows: _______________
[ ] Visible features:
    [ ] Users Management
    [ ] Settings
    [ ] Revenue/Finance
    [ ] Reports
    [ ] Other: _______________
[ ] NO error messages
```

**Result:** ☐ PASS  ☐ FAIL

### Test 2B: Admin Dashboard

```
[ ] Sign in as: ________________ (Admin)
[ ] Dashboard title shows: _______________
[ ] Visible features:
    [ ] Users Management (limited to: ________)
    [ ] Settings (limited to: ________)
    [ ] Revenue/Finance (limited to: ________)
[ ] Super Admin-only features NOT visible:
    [ ] ________________
    [ ] ________________
```

**Result:** ☐ PASS  ☐ FAIL

### Test 2C: Teacher Dashboard

```
[ ] Sign in as: ________________ (Teacher)
[ ] Dashboard title shows: _______________
[ ] Visible features:
    [ ] Attendance
    [ ] Results
    [ ] Assignments
    [ ] Lesson Plans
[ ] Admin features NOT visible:
    [ ] Users Management
    [ ] Settings
    [ ] Revenue
```

**Result:** ☐ PASS  ☐ FAIL

### Test 2D: Student Dashboard

```
[ ] Sign in as: ________________ (Student)
[ ] Dashboard title shows: _______________
[ ] Visible features:
    [ ] My Invoices
    [ ] My Receipts
    [ ] My Results
    [ ] My Attendance
[ ] Admin/Teacher features NOT visible:
    [ ] Attendance Management
    [ ] Revenue
    [ ] Settings
```

**Result:** ☐ PASS  ☐ FAIL

### Test 2E: Deleted Profile (Missing Role)

```
[ ] Go to Firebase Console
[ ] Delete user document for: ________________
[ ] Keep Firebase Auth entry
[ ] Try to sign in with this user
[ ] Expected: "Account profile incomplete" error
[ ] Error appears: ☐ Yes  ☐ No
[ ] NOT defaulting to Student role: ☐ Confirmed
```

**Result:** ☐ PASS  ☐ FAIL

**Test 2 Overall Result:** ☐ PASS  ☐ FAIL  
**Notes:** _______________________________________________

---

## TEST 3: CROSS-DEVICE SYNC

### Prerequisites
- [ ] Device A: Mobile (or tablet)
- [ ] Device B: Desktop
- [ ] Both logged in to same account
- [ ] Both connected to internet

### Test 3A: Student Creation on Device A

```
Device A (Mobile):
  [ ] Go to: Students
  [ ] Click: Add Student
  [ ] Enter:
      - Name: "Test Student ________"
      - Admission: "TS-_______"
      - Class: "JSS1"
  [ ] Click [Save]
  [ ] Verify saved locally: ☐ Yes

Device B (Desktop):
  [ ] Already on Students page
  [ ] Wait: 5 seconds (no refresh)
  [ ] New student appears: ☐ Yes  ☐ No
  [ ] Time to sync: _________ seconds
```

**Result:** ☐ PASS  ☐ FAIL

### Test 3B: Invoice Creation While Offline

```
Device A (Mobile):
  [ ] Go offline (WiFi off, airplane mode on)
  [ ] Go to: Invoices
  [ ] Create new invoice:
      - Student: "Test Invoice"
      - Amount: ₦5,000
  [ ] Click [Save]
  [ ] Verify saved locally: ☐ Yes
  [ ] Check Sync Center (#/syncreport):
      - Status: _______________
      - Pending: _____ operations

Device B (Desktop):
  [ ] Refresh page: F5
  [ ] New invoice visible: ☐ Yes  ☐ No
  [ ] Expected: NO (Device A offline)

Device A (Mobile):
  [ ] Go back online (reconnect WiFi)
  [ ] Wait 10 seconds
  [ ] Check Sync Center:
      - Pending: _____ operations
      - Status: _______________

Device B (Desktop):
  [ ] Wait 10 seconds
  [ ] Refresh page: F5
  [ ] New invoice now visible: ☐ Yes  ☐ No
  [ ] Time to appear: _________ seconds
```

**Result:** ☐ PASS  ☐ FAIL

### Test 3C: Simultaneous Edit (Conflict)

```
Device A (Mobile):
  [ ] Edit invoice: Amount ₦5,000 → ₦7,000
  [ ] Go offline before sync
  [ ] Check Sync Center: Pending = 1 ✓

Device B (Desktop):
  [ ] Edit same invoice: Amount ₦5,000 → ₦8,000
  [ ] Save → Syncs immediately ✓
  [ ] Invoice shows: ₦8,000 ✓

Device A (Mobile):
  [ ] Go back online
  [ ] Sync occurs
  [ ] Check Sync Center:
      - Conflict detected: ☐ Yes  ☐ No
      - Status: _______________

Device B (Desktop):
  [ ] Refresh page
  [ ] Invoice amount shows: ₦_______
  [ ] Expected: ₦8,000 (newer value) ✓

Device A (Mobile):
  [ ] Refresh page
  [ ] Invoice amount shows: ₦_______
  [ ] Expected: ₦8,000 (matches Device B) ✓
```

**Result:** ☐ PASS  ☐ FAIL

**Test 3 Overall Result:** ☐ PASS  ☐ FAIL  
**Notes:** _______________________________________________

---

## TEST 4: PROMOTION ENGINE

### Prerequisites
- [ ] At least 30 students in database
- [ ] Students distributed across JSS1, JSS2, JSS3, SS1, SS2, SS3

### Execution

```
Go to: Promotion module

[ ] See promotion options:
    [ ] JSS1 → JSS2
    [ ] JSS2 → JSS3
    [ ] JSS3 → SS1
    [ ] SS1 → SS2
    [ ] SS2 → SS3

Test: Promote 5 students JSS1 → JSS2
  [ ] Select 5 JSS1 students
  [ ] Select target: JSS2
  [ ] Click [Promote All]
  [ ] Confirmation dialog appears: ☐ Yes
  [ ] Click [Confirm]
  
  Firebase Verification:
  [ ] Go to Firestore
  [ ] Open students collection
  [ ] Check one promoted student:
      - class: _____ (expected: JSS2)
      - sessionUpdated: _____ (today's date?)
  [ ] All 5 students updated: ☐ Yes  ☐ No
  
  Promotion History:
  [ ] View promoted student details
  [ ] See "Promotion History":
      - Old: JSS1, New: JSS2
      - Date: _______________
  [ ] Entry correct: ☐ Yes  ☐ No

Test: Promote to higher classes
  [ ] Promote 3 from JSS2 → JSS3
      - JSS2 → JSS3: ☐ Success
  [ ] Promote 2 from JSS3 → SS1
      - JSS3 → SS1: ☐ Success
  [ ] Promote 1 from SS1 → SS2
      - SS1 → SS2: ☐ Success
  [ ] Promote 1 from SS2 → SS3
      - SS2 → SS3: ☐ Success
```

**Result:** ☐ PASS  ☐ FAIL  
**Notes:** _______________________________________________

---

## TEST 5: EXAM ELIGIBILITY

### Prerequisites
- [ ] Create Student A with ₦0 outstanding
- [ ] Create Student B with ₦5,000 outstanding
- [ ] Exams module active

### Execution

```
Go to: Exams → Exam Registration

Test: Student A (₦0 balance)
  [ ] Search: Student A
  [ ] Status shows: "_______________"
  [ ] Expected: "Eligible" or "Can Register"
  [ ] Can register for exam: ☐ Yes  ☐ No

Test: Student B (₦5,000 outstanding)
  [ ] Search: Student B
  [ ] Status shows: "_______________"
  [ ] Expected: "Not Eligible" or "Cannot Register"
  [ ] Error message: _______________
  [ ] Contains "Outstanding Balance": ☐ Yes  ☐ No
  [ ] Prevented from registering: ☐ Yes  ☐ No

Test: Dynamic Update
  [ ] Student B pays ₦5,000
  [ ] Refresh exam registration page
  [ ] Student B status now: "_______________"
  [ ] Now eligible: ☐ Yes  ☐ No
```

**Result:** ☐ PASS  ☐ FAIL  
**Notes:** _______________________________________________

---

## TEST 6: INVENTORY CALCULATION

### Prerequisites
- [ ] Inventory module empty or small

### Execution

```
Go to: Inventory

[ ] Add Item 1: Books
    - Quantity: 2000
    - Unit Cost: ₦5
    - Expected Total: 2000 × 5 = ₦10,000
    [ ] Total shows: ₦_______

[ ] Add Item 2: Uniforms
    - Quantity: 5000
    - Unit Cost: ₦4
    - Expected Total: 5000 × 4 = ₦20,000
    [ ] Total shows: ₦_______

[ ] Check: "Total Stock Value" at bottom
    [ ] Shows: ₦_______
    [ ] Expected: ₦30,000 (10,000 + 20,000)
    [ ] Correct: ☐ Yes  ☐ No

[ ] Edit Item 1: Change Qty to 3000
    [ ] Item 1 updates to: ₦_______
    [ ] Expected: 3000 × 5 = ₦15,000
    [ ] Total Stock Value now: ₦_______
    [ ] Expected: ₦35,000 (15,000 + 20,000)
    [ ] Instant update (no refresh needed): ☐ Yes

[ ] Delete Item 1
    [ ] Item removed from list: ☐ Yes
    [ ] Total Stock Value now: ₦_______
    [ ] Expected: ₦20,000 (just Item 2)
```

**Result:** ☐ PASS  ☐ FAIL  
**Notes:** _______________________________________________

---

## TEST 7: TERM 2 INVOICE GENERATION

### Prerequisites
- [ ] 50+ active students
- [ ] Fee structure configured for Term 2
- [ ] Students in multiple classes (JSS1, JSS2, SS1, etc.)

### Execution

```
Go to: Invoices → Generate Invoices

[ ] Select Term: "Term 2" or "Second Term"
[ ] Verify shows correct term: _______________
[ ] Year/Academic Session: _______________

[ ] Click [Generate Invoices]
[ ] Processing... (wait for completion)
[ ] Completion message: _______________

[ ] Count invoices generated: _____ expected 50+
[ ] Check first invoice (e.g., INV-0001):
    - Term shown: _______________
    - Expected: "Term 2" ✓
    - Amount: ₦_______
    - Student class: _______________
    
[ ] Check invoice for different class:
    - Fee structure matches Term 2 rates: ☐ Yes  ☐ No
    - Tuition amount: ₦_______
    - Exam fees: ₦_______
    - Other fees: ₦_______

[ ] Verify no duplicates:
    [ ] Each student has exactly 1 invoice
    [ ] No gaps in invoice numbers
    [ ] Sequential numbering: ☐ Yes
```

**Result:** ☐ PASS  ☐ FAIL  
**Notes:** _______________________________________________

---

## TEST 8: BULK ZIP INVOICES

### Prerequisites
- [ ] 20+ invoices exist
- [ ] Mixed student classes represented

### Execution

```
Go to: Invoices → Bulk Invoice

[ ] Select: First 20 invoices (or create selection)
[ ] Click [Generate ZIP]
[ ] Browser download starts: ☐ Yes

[ ] File downloaded: Invoices.zip
[ ] File size: _________ MB (expected 5-20 MB)

[ ] Extract ZIP file to: __________________
[ ] Verify contents:
    - Total files: _____ (expected 20)
    - File names pattern: Invoice_000X.pdf ✓
    - All PDFs readable: ☐ Yes

[ ] Open first PDF (Invoice_0001.pdf):
    - School name visible: _______________
    - Student name visible: _______________
    - Invoice number: _______________
    - Amount: ₦_______
    - Page format: ☐ A4
    - Watermark present: ☐ Yes  ☐ No
    - Professional layout: ☐ Yes  ☐ No

[ ] Cross-check with database:
    - Student name matches: ☐ Yes  ☐ No
    - Amount matches: ☐ Yes  ☐ No
    - Due date matches: ☐ Yes  ☐ No

[ ] Check 3 random PDFs (spot check):
    - PDF_0007: ☐ OK  ☐ Issue: __________
    - PDF_0013: ☐ OK  ☐ Issue: __________
    - PDF_0019: ☐ OK  ☐ Issue: __________
```

**Result:** ☐ PASS  ☐ FAIL  
**Notes:** _______________________________________________

---

## TEST 9: SOFT DELETE WITH AUDIT

### Prerequisites
- [ ] 5+ invoices exist
- [ ] Audit module active

### Execution

```
Go to: Invoices

[ ] Select invoice: INV-________
[ ] Click [Delete]
[ ] Confirmation dialog: "Delete invoice?" ☐ Yes
[ ] Click [Confirm]

[ ] Invoice disappears from list: ☐ Yes

Firebase Verification:
[ ] Go to Firebase Console → Firestore
[ ] Find invoices collection
[ ] Find deleted invoice: INV-________
[ ] Check fields:
    - isDeleted: ☐ true  ☐ false
    - deletedAt: _______________
    - deletedBy: _______________
[ ] Original data still present: ☐ Yes

Audit Log Check:
[ ] Go to: Audit module
[ ] Filter/search for: "INVOICE_DELETED"
[ ] Find entry: _______________
[ ] Entry shows:
    - Invoice ID: INV-________
    - User: _______________
    - Timestamp: _______________
    - Action: _______________

Recycle Bin Check:
[ ] Go to: Recycle Bin
[ ] Find deleted invoice: INV-________
[ ] Status: _______________

Restore Test:
[ ] Click [Restore] on deleted invoice
[ ] Confirmation: ☐ Yes
[ ] Invoice back in main list: ☐ Yes
[ ] Verify in Firebase:
    - isDeleted: ☐ false  ✓
    - deletedAt: ☐ removed
[ ] Audit shows restore entry: ☐ Yes

Bulk Delete Test:
[ ] Select 5 invoices
[ ] Click [Delete All]
[ ] All 5 disappear: ☐ Yes
[ ] All 5 in Recycle Bin: ☐ Yes
[ ] Audit shows 5 entries: ☐ Yes
[ ] Can restore individually: ☐ Yes
```

**Result:** ☐ PASS  ☐ FAIL  
**Notes:** _______________________________________________

---

## TEST 10: DIAGNOSTICS COMMANDS

### Execution

```
Open Browser Console (F12 or Cmd+Option+J)

Test: window.cicRoleAudit()
  [ ] Type: window.cicRoleAudit()
  [ ] Output:
      {
        currentUser: { uid: "____________", email: "____________", role: "____________" },
        permissions: { ... },
        moduleAccess: [ ... ],
        warnings: [ ... ]
      }
  [ ] NO errors: ☐ Yes  ☐ No
  [ ] Role matches current user: ☐ Yes  ☐ No
  [ ] Permissions reasonable: ☐ Yes  ☐ No

Test: window.cicSyncHealth()
  [ ] Type: window.cicSyncHealth()
  [ ] Output:
      {
        cloudStatus: "_______________",
        queueSize: _____,
        lastSyncTime: "_______________",
        pendingOperations: [ ... ],
        failedOperations: [ ... ],
        health: "_______________"
      }
  [ ] NO errors: ☐ Yes  ☐ No
  [ ] Health status reasonable: ☐ Yes  ☐ No
  [ ] Expected values:
      - cloudStatus: "connected" or "synced" ✓
      - queueSize: 0 or small number ✓

Test: window.cicPerfAudit()
  [ ] Type: window.cicPerfAudit()
  [ ] Output:
      {
        pageLoadTime: _____ ms,
        renderTime: _____ ms,
        listenerCount: _____,
        dbOperationCount: _____,
        networkLatency: _____ ms,
        localStorageUsed: "_______________",
        recommendations: [ ... ]
      }
  [ ] NO errors: ☐ Yes  ☐ No
  [ ] All metrics numeric: ☐ Yes  ☐ No
  [ ] Reasonable values (pageLoad < 5000ms): ☐ Yes  ☐ No

Additional Diagnostics:
  [ ] window.cicListenerAudit() works: ☐ Yes  ☐ No
  [ ] window.cicQueueAudit() works: ☐ Yes  ☐ No
  [ ] db.getSyncStats() works: ☐ Yes  ☐ No

Console Errors:
  [ ] Red X marks: ☐ None  ☐ Some: _______________
  [ ] Warnings: ☐ None  ☐ Some: _______________
```

**Result:** ☐ PASS  ☐ FAIL  
**Notes:** _______________________________________________

---

## FINAL SUMMARY

| Test | Result | Pass | Fail | Notes |
|------|--------|------|------|-------|
| 1. Bootstrap | _____ | ☐ | ☐ | |
| 2. Role Hardening | _____ | ☐ | ☐ | |
| 3. Cross-Device Sync | _____ | ☐ | ☐ | |
| 4. Promotion Engine | _____ | ☐ | ☐ | |
| 5. Exam Eligibility | _____ | ☐ | ☐ | |
| 6. Inventory Calc | _____ | ☐ | ☐ | |
| 7. Term Invoice Gen | _____ | ☐ | ☐ | |
| 8. Bulk ZIP | _____ | ☐ | ☐ | |
| 9. Soft Delete | _____ | ☐ | ☐ | |
| 10. Diagnostics | _____ | ☐ | ☐ | |

**Total Passed:** _____/10  
**Total Failed:** _____/10  

### Overall Result

☐ **ALL PASS** → Ready for Production  
☐ **SOME FAIL** → Items to fix: _______________  
☐ **CRITICAL FAIL** → Do not deploy  

### Sign-Off

**Tester Signature:** _______________  
**Date/Time:** _______________  
**Product Manager Approval:** _______________  
**Date/Time:** _______________  

---

**DO NOT DEPLOY UNTIL ALL 10 TESTS PASS**
