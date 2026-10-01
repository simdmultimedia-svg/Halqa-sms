# Fingerprint Service Setup Guide

## Requirements
- Windows 10 or Windows 11 (64-bit recommended)
- DigitalPersona U.are.U 5300 Fingerprint Scanner
- DigitalPersona Runtime Environment (RTE) installed
- .NET Framework or .NET 8 (as specified by C# compilation context)

## 1. Hardware & Driver Installation
1. Connect the DigitalPersona U.are.U 5300 reader to a USB port.
2. Install the DigitalPersona U.are.U RTE. This installs the necessary drivers.
3. Verify the device shows up correctly in the Windows Device Manager under "Biometric devices" or "Personal identification devices".

## 2. Deploying the Local Service
The `DPServer.exe` background service must be deployed to the local machine and running continuously to bridge the web browser with the hardware.

1. Ensure the following files are present in the same directory:
   - `DPServer.exe`
   - `DPUruNet.dll` (Required SDK dependency)
2. To compile from source (if needed), execute `build.bat` in `services/DPService/`.

## 3. Starting the Service
1. Run `DPServer.exe`. 
2. The console window will display: `DigitalPersona Local Service is running on http://127.0.0.1:8080/`
3. Leave this process running. For a production deployment, this should be configured to run silently on Windows Startup (e.g., using a `.bat` file in `shell:startup` or setting it up as a Windows Service).

## 4. Network and Security
- The service binds strictly to `http://127.0.0.1:8080/`.
- **Do not** expose this port to the external network.
- The web application communicates with this service securely via `fetch` from `localhost`.
