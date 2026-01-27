; ArtHub NSIS 安装程序自定义 Hooks
; 深色主题 Modern UI 配置

; 使用 Modern UI 2
!include "MUI2.nsh"

; ========================================
; 深色主题颜色配置
; ========================================
; 背景色：深灰 #1a1a1a
!define MUI_BGCOLOR "0x1a1a1a"
; 文字色：白色
!define MUI_TEXTCOLOR "0xffffff"
; 头部背景：更深的灰 #0f0f0f
!define MUI_HEADERBGCOLOR "0x0f0f0f"
; 头部文字：白色
!define MUI_HEADERTEXTCOLOR "0xffffff"
; 安装页面颜色：深色背景和边框
!define MUI_INSTFILESPAGE_COLORS "0x1a1a1a 0x2a2a2a"
; 按钮颜色：深色主题按钮
!define MUI_BUTTONTEXTCOLOR "0xffffff"

; 安装程序图标
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

; 安装完成页面
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "启动 ArtHub"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchApp"

; 安装页面文本（深色主题友好）
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
