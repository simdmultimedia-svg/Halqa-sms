@echo off
echo Starting CICK Enterprise System...
:: Start DigitalPersona Local Fingerprint Service in the background
start /B "" "services\DPService\DPServer.exe"
:: Start the Web Application on port 8080
python -m http.server 8080 || python3 -m http.server 8080
