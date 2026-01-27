; ArtHub 自定义 NSIS 安装程序模板 - 深色主题
; 基于 NSIS Modern UI 2，应用深色主题样式
; 使用 Handlebars 模板语法，变量会被 Tauri 构建时替换

; 压缩方式（必须在最前面，在任何其他操作之前）
SetCompressor {{compression}}

; 使用 Modern UI 2
!include "MUI2.nsh"

; ========================================
; 深色主题颜色配置
; ========================================
; 背景色：深灰 #1a1a1a (RGB: 26, 26, 26)
!define MUI_BGCOLOR "1a1a1a"
; 文字色：白色
!define MUI_TEXTCOLOR "ffffff"
; 安装页面颜色：深色背景和边框
!define MUI_INSTFILESPAGE_COLORS "ffffff 1a1a1a"

; 安装程序图标
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

; 安装程序属性（必须在页面定义之前）
Name "{{product_name}}"
OutFile "{{output}}"
InstallDir "$PROGRAMFILES\{{product_name}}"
InstallDirRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\{{product_name}}.exe" ""
RequestExecutionLevel admin
ShowInstDetails show
ShowUnInstDetails show

; 欢迎页面
!insertmacro MUI_PAGE_WELCOME

; 许可协议页面（如果有）
{{#if license}}
!insertmacro MUI_PAGE_LICENSE "{{license}}"
{{/if}}

; 安装目录选择页面
!insertmacro MUI_PAGE_DIRECTORY

; 安装文件页面
!insertmacro MUI_PAGE_INSTFILES

; 完成页面
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "启动 {{product_name}}"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchApp"
!insertmacro MUI_PAGE_FINISH

; 卸载确认页面
!insertmacro MUI_UNPAGE_CONFIRM

; 卸载进度页面
!insertmacro MUI_UNPAGE_INSTFILES

; 语言文件
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

; 注意：.onGUIInit 函数由 Tauri 自动生成，不要在这里重复定义
; 深色主题通过 MUI_BGCOLOR 和 MUI_TEXTCOLOR 定义来应用

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
