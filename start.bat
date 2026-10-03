@echo off
rem Lançador do painel — delega ao supervisor multiplataforma (jev.mjs).
node "%~dp0jev.mjs" start %*
