@echo off
set CSC="C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
set DLL="DPUruNet.dll"
%CSC% /nologo /target:exe /out:DPServer.exe /reference:%DLL% DPServer.cs
echo Build complete.
pause
