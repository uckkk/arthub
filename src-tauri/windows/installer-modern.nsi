; ArtHub 极简深色一键安装模板
; 现代风格，一键安装，深色主题
; 使用 Handlebars 模板语法，变量会被 Tauri 构建时替换

; 压缩方式（必须在最前面）
SetCompressor {{compression}}

; 使用 Modern UI 2
!include "MUI2.nsh"

; ========================================
; 极简深色主题配置
; ========================================
; 背景色：深灰 #0f0f0f
!define MUI_BGCOLOR "0f0f0f"
; 文字色：白色
!define MUI_TEXTCOLOR "ffffff"
; 头部背景：更深的灰 #0a0a0a
!define MUI_HEADERBGCOLOR "0a0a0a"
; 头部文字：白色
!define MUI_HEADERTEXTCOLOR "ffffff"
; 安装页面颜色：深色背景
!define MUI_INSTFILESPAGE_COLORS "ffffff 0f0f0f"
; 按钮文字颜色
!define MUI_BUTTONTEXTCOLOR "ffffff"

; 安装程序图标
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

; 安装程序属性
Name "{{product_name}}"
OutFile "{{output}}"
InstallDir "$PROGRAMFILES\{{product_name}}"
InstallDirRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\{{product_name}}.exe" ""
RequestExecutionLevel admin

; 一键安装模式：只显示安装进度页面
!define MUI_PAGE_CUSTOMFUNCTION_SHOW "ShowInstFiles"
!insertmacro MUI_PAGE_INSTFILES

; 完成页面（可选启动应用）
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "启动 {{product_name}}"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchApp"
!insertmacro MUI_PAGE_FINISH

; 卸载页面
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; 语言
!insertmacro MUI_LANGUAGE "SimpChinese"

; 安装程序部分
Section "MainSection" SEC01
  SetOutPath "$INSTDIR"
  
  ; 安装文件
  {{#each files}}
  File "{{this}}"
  {{/each}}
  
  ; 创建快捷方式
  CreateDirectory "$SMPROGRAMS\{{product_name}}"
  CreateShortCut "$SMPROGRAMS\{{product_name}}\{{product_name}}.lnk" "$INSTDIR\{{product_name}}.exe"
  CreateShortCut "$DESKTOP\{{product_name}}.lnk" "$INSTDIR\{{product_name}}.exe"
  
  ; 写入注册表
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\{{product_name}}.exe" "" "$INSTDIR\{{product_name}}.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{product_name}}" "DisplayName" "$(^Name)"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{product_name}}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{product_name}}" "DisplayIcon" "$INSTDIR\{{product_name}}.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{product_name}}" "DisplayVersion" "{{version}}"
  {{#if homepage}}
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{product_name}}" "URLInfoAbout" "{{homepage}}"
  {{/if}}
  {{#if publisher}}
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{product_name}}" "Publisher" "{{publisher}}"
  {{/if}}
  
  ; 创建卸载程序
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

; 启动应用函数
Function LaunchApp
  Exec "$INSTDIR\{{product_name}}.exe"
FunctionEnd

; 自定义安装页面显示函数
Function ShowInstFiles
  ; 隐藏详细信息按钮
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
  
  ; 设置安装页面文本
  FindWindow $0 "#32770" "" $HWNDPARENT
  GetDlgItem $1 $0 1006
  SendMessage $1 ${WM_SETTEXT} 0 "STR:正在安装 {{product_name}}..."
FunctionEnd

; 卸载程序部分
Section Uninstall
  ; 删除文件
  {{#each files}}
  Delete "$INSTDIR\{{this}}"
  {{/each}}
  
  ; 删除快捷方式
  Delete "$SMPROGRAMS\{{product_name}}\{{product_name}}.lnk"
  Delete "$DESKTOP\{{product_name}}.lnk"
  RMDir "$SMPROGRAMS\{{product_name}}"
  
  ; 删除卸载程序
  Delete "$INSTDIR\uninstall.exe"
  
  ; 删除注册表项
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{product_name}}"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\{{product_name}}.exe"
  
  ; 删除安装目录
  RMDir "$INSTDIR"
SectionEnd
