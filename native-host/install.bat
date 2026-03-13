@echo off
chcp 65001 >nul
echo ============================================
echo   豆包收藏助手 - Native Helper 安装程序
echo ============================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Node.js 已安装

:: Get current directory
set SCRIPT_DIR=%~dp0
set HOST_BAT=%SCRIPT_DIR%run-host.bat
set MANIFEST_PATH=%SCRIPT_DIR%com.doubao_collector.native_host.json

:: Get extension ID from user
echo.
echo 请打开 chrome://extensions/ 页面，开启"开发者模式"，
echo 找到"豆包收藏助手"的扩展 ID（一串字母）。
echo.
set /p EXT_ID="请输入扩展 ID: "

if "%EXT_ID%"=="" (
    echo [错误] 扩展 ID 不能为空
    pause
    exit /b 1
)

:: Create native host manifest
:: path 必须指向 .bat/.cmd/.exe，不能直接指向 .js
echo 正在创建 Native Host 配置...

(
echo {
echo   "name": "com.doubao_collector.native_host",
echo   "description": "Doubao Collector Native Helper",
echo   "path": "%HOST_BAT:\=/%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXT_ID%/"
echo   ]
echo }
) > "%MANIFEST_PATH%"

echo [OK] 配置文件已创建: %MANIFEST_PATH%

:: Register in Windows Registry
echo 正在注册 Native Messaging Host...

reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.doubao_collector.native_host" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>nul

if %errorlevel% equ 0 (
    echo [OK] 注册成功
) else (
    echo [错误] 注册失败，请以管理员身份运行
    pause
    exit /b 1
)

echo.
echo ============================================
echo   安装完成！
echo.
echo   扩展 ID: %EXT_ID%
echo   Native Host 已注册，重启 Chrome 后生效。
echo ============================================
echo.
pause
