@echo off
REM Wrapper for Task Scheduler: runs the LabPay scanner and appends output to scanner.log.
REM Keep this file alongside scanner.py.

set BASE=%~dp0
set LOG=%BASE%scanner.log

python "%BASE%scanner.py" >> "%LOG%" 2>&1
exit /b %ERRORLEVEL%
