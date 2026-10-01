# DigitalPersona Fingerprint Integration API Documentation

This document outlines the REST API endpoints provided by the local Windows Background Service (`DPServer.exe`) and the corresponding Javascript SDK (`js/core/fingerprint.js`) functions.

## Local REST API (http://127.0.0.1:8080)

### 1. `GET /status`
Returns the operational status of the service and connected reader.
**Response:**
```json
{
  "status": "running",
  "reader_ready": true,
  "reader_name": "DigitalPersona U.are.U 5300 Fingerprint Reader",
  "reader_serial": "xxxx-xxxx-xxxx",
  "sdk_version": "3.0.0"
}
```

### 2. `GET /readers`
Returns a list of all detected DigitalPersona readers.
**Response:**
```json
{
  "success": true,
  "readers": [
    {
      "name": "DigitalPersona U.are.U 5300 Fingerprint Reader",
      "serial": "xxxx-xxxx-xxxx"
    }
  ]
}
```

### 3. `POST /capture`
Initiates a single fingerprint capture. Blocks until a finger is placed or a timeout occurs.
**Response:**
```json
{
  "success": true,
  "template": "Base64_Encoded_ISO_FMD...",
  "quality": 0 
}
```
*(Quality: Lower is better. 0 = best)*

### 4. `POST /enroll`
Initiates a multi-step enrollment capture (requires 4 scans to extract a highly reliable enrollment template).
**Response:**
```json
{
  "success": true,
  "template": "Base64_Encoded_ISO_FMD..."
}
```

### 5. `POST /verify`
Verifies a live finger against a single stored template (1:1 Matching).
**Request Body:**
```json
{
  "storedFmd": "Base64_Template",
  "scannedFmd": "Base64_Template"
}
```
**Response:**
```json
{
  "success": true,
  "score": 0
}
```

### 6. `POST /identify`
Identifies a live finger against a list of enrolled templates (1:N Matching).
**Request Body:**
```json
{
  "scannedFmd": "Base64_Template",
  "allFmds": "Template1,Template2,Template3"
}
```
**Response:**
```json
{
  "success": true,
  "matchIndex": 2,
  "score": 0
}
```

### 7. `POST /cancel`
Aborts an ongoing capture operation (unblocks the thread).

---

## Javascript SDK (`js/core/fingerprint.js`)

The module exports several wrapped asynchronous functions that interface seamlessly with the API endpoints.

- `fingerprintServiceAvailable()`: Checks if the service is running. Returns `boolean`.
- `getFingerprintDiagnostics()`: Returns service diagnostics details via `/status`.
- `getConnectedReaders()`: Returns list of readers via `/readers`.
- `captureFingerprint()`: Captures a fingerprint via `/capture`. Returns `{ success, template, error }`.
- `enrollFingerprint()`: Captures 4 scans for enrollment via `/enroll`. Returns `{ success, template, error }`.
- `verifyFingerprint(scannedFmd, storedFmd)`: Verifies two templates.
- `identifyFingerprint(scannedFmd, allFmdsArray)`: Identifies a template against an array of base64 FMDs.
- `cancelFingerprintCapture()`: Cancels a pending capture via `/cancel`.

### Error Handling
The SDK maps native or fetch errors to user-friendly UI diagnostics:
- `Driver Missing`
- `SDK Missing`
- `Reader Disconnected`
- `Capture Timeout`
- `Poor Quality`
- `Local Service Not Running`
