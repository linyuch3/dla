@echo off
echo 正在推送到GitHub...
cd /d "d:\下载\cloudpanel-main"
git push -u origin main
if %errorlevel% equ 0 (
    echo 推送成功！
) else (
    echo 推送失败，请检查网络连接或稍后重试
)
pause
