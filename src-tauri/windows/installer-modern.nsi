; ArtHub 极简深色一键安装模板
; 现代风格，一键安装，深色主题
; 基于 Tauri 官方模板结构，使用 Handlebars 模板语法

Unicode true
ManifestDPIAware true
ManifestDPIAwareness PerMonitorV2

; 压缩方式
!if "{{compression}}" == "none"
  SetCompress off
!else
  SetCompressor /SOLID "{{compression}}"
!endif

; 使用 Modern UI 2
!include "MUI2.nsh"

; ========================================
; 定义变量（必须在 OutFile 之前）
; ========================================
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define OUTFILE "{{out_file}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"

; ========================================
; 安装程序属性
; ========================================
Name "${PRODUCTNAME}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES\${PRODUCTNAME}"
InstallDirRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\${PRODUCTNAME}.exe" ""
RequestExecutionLevel admin

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
!if "{{installer_icon}}" != ""
  !define MUI_ICON "{{installer_icon}}"
  !define MUI_UNICON "{{installer_icon}}"
!else
  ; 尝试多个可能的路径
  !if /FileExists "icons\icon.ico"
    !define MUI_ICON "icons\icon.ico"
    !define MUI_UNICON "icons\icon.ico"
  !else
    !if /FileExists "..\icons\icon.ico"
      !define MUI_ICON "..\icons\icon.ico"
      !define MUI_UNICON "..\icons\icon.ico"
    !else
      !define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
      !define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"
    !endif
  !endif
!endif

; ========================================
; 安装页面（一键安装模式：只显示安装进度）
; ========================================
!insertmacro MUI_PAGE_INSTFILES

; ========================================
; 完成页面（可选启动应用）
; ========================================
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "启动 ${PRODUCTNAME}"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchApp"
!insertmacro MUI_PAGE_FINISH

; ========================================
; 卸载页面
; ========================================
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; ========================================
; 语言
; ========================================
!insertmacro MUI_LANGUAGE "SimpChinese"

; ========================================
; 安装程序部分
; ========================================
Section "MainSection" SEC01
  SetOutPath "$INSTDIR"
  
  ; 安装主程序
  File "${MAINBINARYSRCPATH}"
  
  ; 安装资源文件
  {{#each resources_dirs}}
    CreateDirectory "$INSTDIR\\{{this}}"
  {{/each}}
  {{#each resources}}
    File /a "/oname={{this.[1]}}" "{{no-escape @key}}"
  {{/each}}
  
  ; 安装外部二进制文件
  {{#each binaries}}
    File /a "/oname={{this}}" "{{no-escape @key}}"
  {{/each}}
  
  ; 创建快捷方式
  CreateDirectory "$SMPROGRAMS\${PRODUCTNAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  CreateShortCut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  
  ; 写入注册表
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\${PRODUCTNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" "DisplayIcon" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" "DisplayVersion" "${VERSION}"
  {{#if homepage}}
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" "URLInfoAbout" "{{homepage}}"
  {{/if}}
  {{#if publisher}}
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" "Publisher" "{{publisher}}"
  {{/if}}
  
  ; 创建卸载程序
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

; ========================================
; 启动应用函数
; ========================================
Function LaunchApp
  Exec "$INSTDIR\${MAINBINARYNAME}.exe"
FunctionEnd

; ========================================
; 自定义安装页面文本
; ========================================
!define MUI_INSTFILESPAGE_TEXT_TOP "正在安装 ${PRODUCTNAME}..."
!define MUI_INSTFILESPAGE_TEXT_COMPONENTS_DESC ""

; ========================================
; 卸载程序部分
; ========================================
Section Uninstall
  ; 删除主程序
  Delete "$INSTDIR\${MAINBINARYNAME}.exe"
  
  ; 删除资源文件
  {{#each resources}}
    Delete "$INSTDIR\\{{this.[1]}}"
  {{/each}}
  
  ; 删除外部二进制文件
  {{#each binaries}}
    Delete "$INSTDIR\\{{this}}"
  {{/each}}
  
  ; 删除快捷方式
  Delete "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk"
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCTNAME}"
  
  ; 删除卸载程序
  Delete "$INSTDIR\uninstall.exe"
  
  ; 删除注册表项
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\${PRODUCTNAME}.exe"
  
  ; 删除安装目录
  {{#each resources_ancestors}}
  RMDir /REBOOTOK "$INSTDIR\\{{this}}"
  {{/each}}
  RMDir "$INSTDIR"
SectionEnd
