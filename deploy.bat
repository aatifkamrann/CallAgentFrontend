@echo off
title AI Voice Agent - Production Deploy
echo ============================================
echo    Production Deployment Script
echo    Target: IIS + Express on localhost:3001
echo ============================================
echo.

set "PROJECT_ROOT=%~dp0"

:: --- Step 1: Build frontend ---
echo [1/4] Building frontend (Vite)...
cd /d "%PROJECT_ROOT%"
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Frontend build failed!
    pause
    exit /b 1
)
echo [OK] Frontend built to dist/

:: --- Step 2: Verify web.config in dist ---
if exist "dist\web.config" (
    echo [OK] web.config present in dist/
) else (
    echo [WARN] web.config missing from dist/ - copying manually...
    copy web.config dist\web.config >nul
)

:: --- Step 3: Set production SERVER_URL ---
echo.
echo [2/4] Configuring production environment...
cd /d "%PROJECT_ROOT%server"

:: Update SERVER_URL to production domain
node -e "const fs=require('fs');const f='.env';let c=fs.readFileSync(f,'utf8');c=c.replace(/^SERVER_URL=.*/m,'SERVER_URL=https://callagent.astrikdigital.com');fs.writeFileSync(f,c);" 2>nul
echo [OK] SERVER_URL set to https://callagent.astrikdigital.com

:: --- Step 4: Install server dependencies ---
echo.
echo [3/4] Installing server dependencies...
cd /d "%PROJECT_ROOT%server"
call npm install --production --silent
echo [OK] Server dependencies installed

:: --- Step 5: Start Express server ---
echo.
echo [4/4] Starting Express server on port 3001...
echo.
echo ============================================
echo  DEPLOYMENT READY
echo ============================================
echo.
echo  Frontend: Copy dist/ folder to IIS site root
echo  Backend:  Express running on localhost:3001
echo  Domain:   https://callagent.astrikdigital.com
echo.
echo  IIS CHECKLIST:
echo    1. URL Rewrite Module installed
echo    2. ARR enabled with proxy ON
echo    3. WebSocket Protocol enabled
echo    4. Site physical path = dist/ folder
echo    5. SSL certificate configured
echo.
echo  Press Ctrl+C to stop the server
echo ============================================
echo.

cd /d "%PROJECT_ROOT%server"
node index.js