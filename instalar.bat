@echo off
rem Instalacao completa com um duplo clique:
rem instala dependencias (se faltar), cria o icone na area de trabalho
rem e sobe o painel no navegador.
node "%~dp0jev.mjs" tudo
echo.
pause
