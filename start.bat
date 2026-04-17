@echo off
title AI Voice Agent - Starting...

echo ============================================
echo    AI Voice Agent - Auto Setup and Launch
echo ============================================
echo.

:: Save project root
set "PROJECT_ROOT=%~dp0"

:: --- Step 0: Check Node.js ---
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found! Install from https://nodejs.org
    pause
    exit /b 1
)
echo [OK] Node.js found
node -v

:: --- Step 1: Install frontend dependencies ---
echo.
echo [1/6] Installing frontend dependencies...
cd /d "%PROJECT_ROOT%"
call npm install --silent
if %errorlevel% neq 0 (
    echo [ERROR] Frontend install failed!
    pause
    exit /b 1
)
echo [OK] Frontend dependencies installed

:: --- Step 2: Install server dependencies ---
echo.
echo [2/6] Installing server dependencies...
cd /d "%PROJECT_ROOT%server"
call npm install --silent
if %errorlevel% neq 0 (
    echo [ERROR] Server install failed!
    pause
    exit /b 1
)
echo [OK] Server dependencies installed

:: --- Step 3: Ensure server .env exists ---
echo.
if not exist .env (
    echo [3/6] Creating server .env from template...
    copy .env.example .env >nul
    echo [WARN] Edit server\.env to add your API keys before making calls!
) else (
    echo [3/6] Server .env already exists - OK
)

:: --- Step 4: Kill old processes ---
echo.
echo [4/6] Cleaning up old processes...

:: Kill any process on port 3001 (server only, NOT ngrok)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001.*LISTENING" 2^>nul') do (
    taskkill /f /pid %%a >nul 2>nul
)
timeout /t 2 /nobreak >nul
echo [OK] Old server processes cleaned

:: --- Step 5: Detect or start ngrok tunnel ---
echo.
echo [5/6] Setting up ngrok tunnel...
set "NGROK_URL="
set "CURRENT_SERVER_URL="

:: First check if ngrok is ALREADY running (user started it manually)
echo [INFO] Checking if ngrok is already running...
curl -sf http://127.0.0.1:4040/api/tunnels >nul 2>nul
if not errorlevel 1 (
    echo [OK] ngrok is already running! Fetching URL...
    goto :ngrok_api_ready
)

:: ngrok not running, try to start it
where ngrok >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo [WARN] ngrok not found in PATH!
    echo.
    echo  HOW TO INSTALL ngrok:
    echo  1. Go to https://ngrok.com/download
    echo  2. Sign up for free and get authtoken
    echo  3. Download ngrok.exe for Windows
    echo  4. Place ngrok.exe in a folder in your PATH
    echo  5. Run: ngrok config add-authtoken YOUR_TOKEN
    echo  6. Re-run this start.bat
    echo.
    echo  Continuing WITHOUT ngrok...
    echo  Browser testing will work, but real Twilio calls won't.
    echo.
    goto :skip_ngrok
)

echo [INFO] Starting ngrok on port 3001...
start "AI Voice Agent - ngrok" /min cmd /c "ngrok http 3001"

echo [INFO] Waiting for ngrok to be ready...
for /L %%i in (1,1,20) do (
    curl -sf http://127.0.0.1:4040/api/tunnels >nul 2>nul
    if not errorlevel 1 goto :ngrok_api_ready
    echo   - Attempt %%i/20: ngrok not ready yet
    timeout /t 2 /nobreak >nul
)

echo [ERROR] ngrok did not start after 40 seconds.
echo [WARN] Start ngrok manually: ngrok http 3001
echo [WARN] Then set SERVER_URL in server\.env manually
goto :skip_ngrok

:ngrok_api_ready
echo [OK] ngrok inspector is reachable at http://127.0.0.1:4040
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "(Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels').tunnels | Where-Object {$_.proto -eq 'https'} | Select-Object -ExpandProperty public_url -First 1"`) do set "NGROK_URL=%%a"

if "%NGROK_URL%"=="" (
    echo [ERROR] ngrok running but no HTTPS URL found.
    echo [WARN] Set SERVER_URL in server\.env manually
    goto :skip_ngrok
)

echo [OK] ngrok public URL: %NGROK_URL%
echo [INFO] Updating server\.env with SERVER_URL...
cd /d "%PROJECT_ROOT%server"
node -e "const fs=require('fs');const f='.env';let c=fs.readFileSync(f,'utf8');if(/^SERVER_URL=.*/m.test(c)){c=c.replace(/^SERVER_URL=.*/m,'SERVER_URL='+process.argv[1]);}else{c+='\nSERVER_URL='+process.argv[1]+'\n';}fs.writeFileSync(f,c);" "%NGROK_URL%"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to update server\.env
    goto :skip_ngrok
)
for /f "tokens=1,* delims==" %%x in ('findstr /b "SERVER_URL=" .env') do set "CURRENT_SERVER_URL=%%y"
echo [OK] SERVER_URL saved in server\.env: %CURRENT_SERVER_URL%

:skip_ngrok

:: --- Step 6: Start both servers ---
echo.
echo [6/6] Starting servers...
echo.
echo ============================================
echo  Frontend:  http://localhost:5173
echo  Backend:   http://localhost:3001
if defined NGROK_URL (
    echo  ngrok:     %NGROK_URL%
    echo.
    echo  Twilio webhook URL:
    echo    %NGROK_URL%/api/calls/media-stream
)
echo.
echo  Press Ctrl+C in each window to stop
echo ============================================
echo.

:: Start Express server in a new window (chcp 65001 = UTF-8 code page so emoji/arrows display correctly)
set "SERVER_DIR=%PROJECT_ROOT%server"
start "AI Voice Agent - API Server (port 3001)" cmd /k "chcp 65001 >nul && cd /d %SERVER_DIR% && node index.js"

:: Wait for server to be ready
echo Waiting for API server to start...
for /L %%i in (1,1,15) do (
    timeout /t 2 /nobreak >nul
    curl -sf http://localhost:3001/api/health >nul 2>nul
    if not errorlevel 1 goto :server_ready
)
echo [WARN] Server may not have started. Check the server window for errors.
goto :start_frontend

:server_ready
echo [OK] API server is running on port 3001

:start_frontend
echo.
echo Starting frontend dev server...
cd /d "%PROJECT_ROOT%"
call npm run dev
