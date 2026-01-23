; ArtHub NSIS 安装程序自定义 Hooks
; 用于美化安装界面，使用 Modern UI

; 使用 Modern UI 2
!include "MUI2.nsh"

; 安装程序图标
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

; 欢迎页面图片（可选，如果有的话）
; !define MUI_WELCOMEFINISHPAGE_BITMAP "${NSISDIR}\Contrib\Graphics\Wizard\win.bmp"
; !define MUI_UNWELCOMEFINISHPAGE_BITMAP "${NSISDIR}\Contrib\Graphics\Wizard\win.bmp"

; 头部图片（可选）
; !define MUI_HEADERIMAGE
; !define MUI_HEADERIMAGE_BITMAP "${NSISDIR}\Contrib\Graphics\Header\nsis3-grey.bmp"
; !define MUI_HEADERIMAGE_UNBITMAP "${NSISDIR}\Contrib\Graphics\Header\nsis3-grey.bmp"

; 安装完成页面
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "启动 ArtHub"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchApp"

; 安装完成页面显示复选框
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "查看更新日志"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION "ShowReadme"

; 安装页面文本
!define MUI_INSTFILESPAGE_TEXT_TOP "ArtHub 正在安装到您的计算机。"
!define MUI_INSTFILESPAGE_TEXT_COMPONENTS_DESC "选择要安装的组件。"

; 卸载确认页面
!define MUI_UNCONFIRMPAGE_TEXT_TOP "ArtHub 将从您的计算机中卸载。"

; 自定义安装完成函数
Function LaunchApp
  Exec "$INSTDIR\ArtHub.exe"
FunctionEnd

; 显示更新日志函数
Function ShowReadme
  ExecShell "open" "https://github.com/uckkk/arthub/releases"
FunctionEnd

; 安装前检查
Function .onInit
  ; 检查是否已安装
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArtHub" "UninstallString"
  StrCmp $R0 "" done
  
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
    "ArtHub 已经安装。$\n$\n点击 '确定' 卸载旧版本，或 '取消' 取消此升级。" \
    IDOK uninst
  Abort
  
  uninst:
    ClearErrors
    ExecWait '$R0 _?=$INSTDIR'
    
    IfErrors no_remove_uninstaller done
    no_remove_uninstaller:
  
  done:
FunctionEnd

; 安装后处理
Function .onInstSuccess
  ; 可以在这里添加安装后的自定义操作
  ; 例如：创建配置文件、设置注册表等
FunctionEnd

; 卸载前处理
Function un.onInit
  MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON2 \
    "确定要完全移除 ArtHub 及其所有组件吗？" \
    IDYES +2
  Abort
FunctionEnd

; 卸载后处理
Function un.onUninstSuccess
  ; 可以在这里添加卸载后的清理操作
FunctionEnd
