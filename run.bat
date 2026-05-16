@echo off
title PixelArena - Dev Server
color 0A

echo ============================================
echo    PixelArena - Starting Development Server
echo ============================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo [INFO] Node.js version:
node --version
echo.

:: Check if .env exists, if not copy from example
if not exist ".env" (
    echo [INFO] Creating .env from .env.example...
    copy .env.example .env >nul
    echo [INFO] .env created. Edit it to add your API keys.
    echo.
)

:: Install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm install
    echo.
)

echo [INFO] Starting development servers...
echo [INFO] Client: http://localhost:5173
echo [INFO] Server: http://localhost:3000
echo.
echo Press Ctrl+C to stop.
echo.

call npm run dev

pause
