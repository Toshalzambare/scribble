@echo off
echo Starting Dynamic Skribble Application...
echo.
echo Make sure you have copied backend/.env.example to backend/.env and added your keys.
echo.

docker-compose up --build
